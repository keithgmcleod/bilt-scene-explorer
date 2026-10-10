import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { HDRLoader } from './HDRLoader.js';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const loading = document.querySelector('#loading');
const loadingText = document.querySelector('#loading-text');
const progress = document.querySelector('#progress');
const cards = [...document.querySelectorAll('[data-camera]')];
const durationInput = document.querySelector('#duration');
const motionToggle = document.querySelector('#animate-camera');
const cameraResponse = await fetch('./assets/cameras.json');
if (!cameraResponse.ok) throw new Error('Camera configuration could not load');
const sourceCameras = await cameraResponse.json();
// Explicit Blender object mapping; normalize GLTFLoader's sanitized names.
const cardCameraMap = new Map([['BLUE002',1],['BLUE001',2],['BLUE003',3]]);
const normalizeName = name => name.toUpperCase().replace(/[._]/g,'');
const overviewButton = document.querySelector('#overview');
const cardInformation = [null,
  {name:'BILT Obsidian',description:'Discover BILT Obsidian from a closer perspective.'},
  {name:'BILT Palladium',description:'Discover BILT Palladium from a closer perspective.'},
  {name:'BILT Blue',description:'Discover BILT Blue from a closer perspective.'}
];
function updateCardInformation(index) {
  const information = cardInformation[index];
  document.querySelector('#collection-intro').hidden = Boolean(information);
  document.querySelector('#card-info').hidden = !information;
  if (information) {
    document.querySelector('#card-title').textContent = information.name;
    document.querySelector('#card-description').textContent = information.description;
  }
}
// Blender Z-up to the glTF export's Y-up. Preserve world rotation and discard camera object scale.
const basis = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const views = sourceCameras.map(({name,matrix}) => {
  const world = new THREE.Matrix4().set(...matrix.flat()).premultiply(basis);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  world.decompose(position, quaternion, new THREE.Vector3());
  quaternion.normalize();
  return {name,position,quaternion};
});
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e8e7e2');
const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(0.691111207/2)/(1920/1080))), 1, .01, 1000);
camera.position.copy(views[0].position);
camera.quaternion.copy(views[0].quaternion);
const basePosition = camera.position.clone();
const baseQuaternion = camera.quaternion.clone();
const pointerTarget = new THREE.Vector2();
const pointer = new THREE.Vector2();
const tiltQuaternion = new THREE.Quaternion();
const tiltEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const parallaxOffset = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pickPointer = new THREE.Vector2();
const cardHitboxes = [];
const cardSpotlights = [];
let hoveredCard = null;
let needsHoverCheck = false;
let selectedIndex = 0;
let previousFrame = performance.now();
window.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse') return;
  const bounds = viewport.getBoundingClientRect();
  pointerTarget.set(
    THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1),
    THREE.MathUtils.clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1)
  );
});
document.documentElement.addEventListener('pointerleave', () => pointerTarget.set(0, 0));
window.addEventListener('blur', () => pointerTarget.set(0, 0));
let renderer, transition = null, ready = false;
try {
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewport.append(renderer.domElement);
} catch(error) {
  loadingText.textContent = 'This browser could not start the 3D viewer. Try a browser with WebGL enabled.';
  status.textContent = '3D unavailable';
  throw error;
}
function resize(){
  const {width,height} = viewport.getBoundingClientRect();
  renderer.setSize(width,height);
  camera.aspect = width/height;
  // Match Blender's horizontal sensor fit on wide screens, with a minimum vertical view on mobile.
  camera.fov = fovFor(selectedIndex);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport); resize();
function fovFor(index) {
  return THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(sourceCameras[index].angle/2)/Math.max(camera.aspect,.55)));
}
function setHoveredCard(object) {
  if (object === hoveredCard) return;
  hoveredCard = object;
  viewport.style.cursor = hoveredCard ? 'pointer' : 'default';
}
function pickCard(clientX, clientY) {
  if (!ready) return null;
  const rect = viewport.getBoundingClientRect();
  pickPointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(pickPointer, camera);
  return raycaster.intersectObjects(selectedIndex === 0 ? cardHitboxes.filter(hitbox => hitbox.userData.card.userData.cameraIndex !== undefined) : cardHitboxes, false)[0]?.object.userData.card || null;
}
let latestPointer = null;
viewport.addEventListener('pointermove', event => {
  latestPointer = {x: event.clientX, y: event.clientY};
  needsHoverCheck = true;
});
viewport.addEventListener('pointerleave', () => {
  latestPointer = null;
  setHoveredCard(null);
});
viewport.addEventListener('click', event => {
  const card = pickCard(event.clientX, event.clientY);
  if (card) moveToCamera(selectedIndex === 0 ? card.userData.cameraIndex : 0);
});
function moveToCamera(index){
  if(!ready) return;
  // Click the selected card again to return to camera one.
  if (index !== 0 && index === selectedIndex) index = 0;
  selectedIndex = index;
  updateCardInformation(index);
  const target = views[index];
  setHoveredCard(null);
  // Start from the rendered pose, including its mouse tilt, for seamless interruption.
  basePosition.copy(camera.position);
  baseQuaternion.copy(camera.quaternion);
  pointer.set(0, 0);
  transition = {start:performance.now(),duration:motionToggle.checked?Number(durationInput.value)*1000:0,fromPosition:camera.position.clone(),fromQuaternion:camera.quaternion.clone(),fromFov:camera.fov,targetFov:fovFor(index),target};
  cards.forEach(card=>{const active=Number(card.dataset.camera)===index;card.classList.toggle('active',active);card.setAttribute('aria-pressed',String(active));});
  overviewButton.hidden = index === 0;
  status.textContent = `Moving to ${target.name}`;
}
cards.forEach(card=>card.addEventListener('click',()=>moveToCamera(Number(card.dataset.camera))));
overviewButton.addEventListener('click',()=>moveToCamera(0));
durationInput.addEventListener('input',()=>document.querySelector('#seconds').textContent=`${Number(durationInput.value).toFixed(1)}s`);
renderer.setAnimationLoop(now=>{
  const dt = Math.min(Math.max((now - previousFrame) / 1000, 0), .1);
  previousFrame = now;
  const moving = Boolean(transition);
  if(transition){
    const t=transition.duration===0?1:Math.min(1,(now-transition.start)/transition.duration);
    const eased=t*t*(3-2*t);
    basePosition.lerpVectors(transition.fromPosition,transition.target.position,eased);
    baseQuaternion.slerpQuaternions(transition.fromQuaternion,transition.target.quaternion,eased);
    camera.fov = THREE.MathUtils.lerp(transition.fromFov,transition.targetFov,eased);
    camera.updateProjectionMatrix();
    if(t===1){status.textContent=`Viewing ${transition.target.name}`;transition=null;}
  }
  camera.position.copy(basePosition);
  camera.quaternion.copy(baseQuaternion);
  // Keep the camera flight anchored to the Blender poses, then ease mouse movement back in.
  if (ready && !moving && motionToggle.checked) {
    pointer.lerp(pointerTarget, 1 - Math.exp(-5 * dt));
    tiltEuler.set(-pointer.y * .018, -pointer.x * .025, -pointer.x * .003, 'YXZ');
    tiltQuaternion.setFromEuler(tiltEuler);
    camera.quaternion.multiply(tiltQuaternion);
    parallaxOffset.set(pointer.x * .008, -pointer.y * .006, 0).applyQuaternion(baseQuaternion);
    camera.position.add(parallaxOffset);
  } else {
    pointer.set(0, 0);
  }
  // Simple hitboxes keep hover tests fast even with dense Blender card meshes.
  if (latestPointer) {
    setHoveredCard(moving && selectedIndex === 0 ? null : pickCard(latestPointer.x, latestPointer.y));
    needsHoverCheck = false;
  }
  // Overview lights only the hovered mesh; close-ups light only their selected card.
  for (const {card,light} of cardSpotlights) {
    const active = selectedIndex === 0
      ? !moving && card === hoveredCard
      : card.userData.cameraIndex === selectedIndex;
    const targetIntensity = active ? 1.8 : 0;
    light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, 1 - Math.exp(-12 * dt));
    if (!active && light.intensity < .001) light.intensity = 0;
  }
  renderer.render(scene,camera);
});
async function loadScene(){
  document.querySelector('#retry').hidden=true;
  loadingText.textContent='Loading your scene…';
  try {
    const response=await fetch('./assets/scene.glb.gz');
    if(!response.ok)throw new Error(`Scene request failed: ${response.status}`);
    const total=Number(response.headers.get('Content-Length'))||14665458;
    const reader=response.body.getReader();const chunks=[];let received=0;
    while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;progress.style.width=`${Math.min(100,received/total*100)}%`;loadingText.textContent=`Loading scene · ${Math.min(100,Math.round(received/total*100))}%`;}
    loadingText.textContent='Preparing geometry…';
    const bytes=await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const gltf=await new GLTFLoader().parseAsync(bytes,new URL('./assets/',location.href).href);
    loadingText.textContent='Applying Blender materials…';
    const grid = await new THREE.TextureLoader().loadAsync('./assets/texture_02.png');
    grid.colorSpace = THREE.SRGBColorSpace;
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
    grid.flipY = true;
    grid.anisotropy = renderer.capabilities.getMaxAnisotropy();
    scene.environment = null;
    const highlightHdr = await new HDRLoader().setDataType(THREE.FloatType).loadAsync('./assets/fireplace-edited.hdr');
    highlightHdr.mapping = THREE.EquirectangularReflectionMapping;
    const highlightPmrem = new THREE.PMREMGenerator(renderer);
    const highlightEnvironment = highlightPmrem.fromEquirectangular(highlightHdr).texture;
    highlightHdr.dispose();
    highlightPmrem.dispose();
    gltf.scene.traverse(object => {
      if (!object.isMesh) return;
      if (/^BLUE[0-9]*$/.test(normalizeName(object.name))) {
        object.material = new THREE.MeshPhysicalMaterial({
          name:'EDGE BLUE', color:new THREE.Color(.8,.8,.8),
          metalness:1, roughness:.318605095, clearcoat:1,
          clearcoatRoughness:0, ior:1.5, side:THREE.DoubleSide,
          envMap:highlightEnvironment, envMapIntensity:.12,
          envMapRotation:new THREE.Euler(0,-Math.PI/2,0)
        });
      } else if (/^(PLANE|CUBE)[0-9]*$/.test(normalizeName(object.name))) {
        object.material = new THREE.MeshStandardMaterial({
          name:object.name === 'Cube' ? 'GRID.002' : 'GRID.001',
          color:/^CUBE[0-9]*$/.test(normalizeName(object.name)) ? 0x24282c : 0xffffff,
          map:grid, metalness:0, roughness:.5, side:THREE.DoubleSide
        });
        // Blender Object coordinates → Mapping scale 10 → flat image projection.
        // glTF local axes are (Blender X, Blender Z, -Blender Y).
        const position = object.geometry.attributes.position;
        const uv = new Float32Array(position.count*2);
        for (let i=0; i<position.count; i++) {
          uv[i*2] = position.getX(i)*10;
          uv[i*2+1] = -position.getZ(i)*10;
        }
        object.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
      }
    });
    scene.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    // Aim a dedicated white spotlight at every Blender card.
    gltf.scene.traverse(object => {
      if (!object.isMesh || !/^BLUE[0-9]*$/.test(normalizeName(object.name))) return;
      object.geometry.computeBoundingBox();
      const center = object.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
      const direction = views[0].position.clone().sub(center).normalize();
      const spotlight = new THREE.SpotLight(0xffffff, 0, 3, Math.PI/10, .5, 2);
      spotlight.name = 'Card spotlight ' + object.name;
      spotlight.position.copy(center).addScaledVector(direction,.7).add(new THREE.Vector3(.15,.35,0));
      spotlight.target.position.copy(center);
      scene.add(spotlight,spotlight.target);
      cardSpotlights.push({card:object,light:spotlight});
    });
    gltf.scene.traverse(object => {
      if (!object.isMesh || !/^BLUE[0-9]*$/.test(normalizeName(object.name))) return;
      object.userData.cameraIndex = cardCameraMap.get(normalizeName(object.name));
      object.material = object.material.clone();
      object.userData.originalEmissive = object.material.emissive.clone();
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // A tiny minimum thickness makes picking the thin cards reliable from either side.
      size.max(new THREE.Vector3(.003, .003, .003));
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
      hitbox.matrixAutoUpdate = false;
      hitbox.matrixWorld.copy(object.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
      hitbox.userData.card = object;
      cardHitboxes.push(hitbox);
    });
    ready=true;cards.forEach(card=>card.disabled=false);loading.hidden=true;
    overviewButton.disabled = false;
    status.textContent='Viewing Camera.001';
  }catch(error){console.error(error);loadingText.textContent='The scene could not load. Please try again.';document.querySelector('#retry').hidden=false;status.textContent='Scene loading failed';}
}
document.querySelector('#retry').addEventListener('click',loadScene);
loadScene();

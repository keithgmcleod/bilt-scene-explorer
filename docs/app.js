import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const loading = document.querySelector('#loading');
const loadingText = document.querySelector('#loading-text');
const progress = document.querySelector('#progress');
const cards = [...document.querySelectorAll('[data-camera]')];
const durationInput = document.querySelector('#duration');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sourceCameras = [
  { name:'Camera.001', matrix:[[0.1950554848,0,0,0],[0,-8.526146e-9,-0.1950554848,-0.8434450626],[0,0.1950554848,-8.526146e-9,1.0863890648],[0,0,0,1]] },
  { name:'Camera.002', matrix:[[0.1950554848,2.8134735e-17,1.0382594e-17,-0.4526156783],[-1.0382596e-17,0.1267075688,-0.1482964307,-0.4114981294],[-2.8134735e-17,0.1482964307,0.1267075688,1.3515282869],[0,0,0,1]] }
];
// Blender Z-up to the glTF export's Y-up. Preserve world rotation and discard camera object scale.
const basis = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const views = sourceCameras.map(({name,matrix}) => {
  const world = new THREE.Matrix4().set(...matrix.flat()).premultiply(basis);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  world.decompose(position, quaternion, new THREE.Vector3());
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
const hemisphere = new THREE.HemisphereLight(0xffffff,0x6a7462,2.5);
scene.add(hemisphere);
const key = new THREE.DirectionalLight(0xffffff,3);
key.position.set(-3,6,4); scene.add(key);
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
  camera.fov = THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(0.691111207/2)/Math.max(camera.aspect,1)));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport); resize();
function moveTo(index){
  if(!ready) return;
  // Clicking the current view cues the next camera; the other card selects its own view.
  if(index === selectedIndex) index = (index + 1) % views.length;
  selectedIndex = index;
  const target = views[index];
  // Start from the rendered pose, including its mouse tilt, for seamless interruption.
  basePosition.copy(camera.position);
  baseQuaternion.copy(camera.quaternion);
  pointer.set(0, 0);
  transition = {start:performance.now(),duration:reducedMotion.matches?0:Number(durationInput.value)*1000,fromPosition:camera.position.clone(),fromQuaternion:camera.quaternion.clone(),target};
  cards.forEach((card,i)=>{card.classList.toggle('active',i===index);card.setAttribute('aria-pressed',String(i===index));});
  status.textContent = `Moving to ${target.name}`;
}
cards.forEach(card=>card.addEventListener('click',()=>moveTo(Number(card.dataset.camera))));
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
    if(t===1){status.textContent=`Viewing ${transition.target.name}`;transition=null;}
  }
  camera.position.copy(basePosition);
  camera.quaternion.copy(baseQuaternion);
  // Keep the camera flight anchored to the Blender poses, then ease mouse movement back in.
  if (ready && !moving && !reducedMotion.matches) {
    pointer.lerp(pointerTarget, 1 - Math.exp(-5 * dt));
    tiltEuler.set(-pointer.y * .018, -pointer.x * .025, -pointer.x * .003, 'YXZ');
    tiltQuaternion.setFromEuler(tiltEuler);
    camera.quaternion.multiply(tiltQuaternion);
    parallaxOffset.set(pointer.x * .008, -pointer.y * .006, 0).applyQuaternion(baseQuaternion);
    camera.position.add(parallaxOffset);
  } else {
    pointer.set(0, 0);
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
    scene.add(gltf.scene);
    ready=true;cards.forEach(card=>card.disabled=false);loading.hidden=true;
    status.textContent='Viewing Camera.001';
  }catch(error){console.error(error);loadingText.textContent='The scene could not load. Please try again.';document.querySelector('#retry').hidden=false;status.textContent='Scene loading failed';}
}
document.querySelector('#retry').addEventListener('click',loadScene);
loadScene();

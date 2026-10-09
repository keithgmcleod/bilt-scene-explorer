# BILT Scene Explorer

An interactive Blender scene with subtle mouse parallax and smooth card-triggered camera transitions.

Website: https://keithgmcleod.github.io/bilt-scene-explorer/

## Controls

- Move the mouse to gently tilt the camera.
- Click a card to move to its Blender viewpoint.
- Click the active card to move to the next viewpoint.
- Adjust the transition slider to change the camera travel time.
- Reduced-motion preferences disable the mouse movement and camera animation.

## Editing and hosting

The static website is in `docs/`. GitHub Pages publishes `main` from `/docs`.
Edit `docs/app.js` for camera positions and motion, `docs/style.css` for styling, and `docs/index.html` for card text.
The scene exported from Blender is stored as `docs/assets/scene.glb.gz` and decompressed in the browser.

The viewer uses Three.js 0.180.0, bundled in `docs/vendor/`.

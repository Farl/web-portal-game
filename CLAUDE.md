# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WebGL-based portal rendering demo inspired by Portal/Aperture Science. It implements real-time portal rendering using Three.js with stencil buffer techniques, player traversal through portals, and physics simulation for objects.

## Technology Stack

- **Three.js v0.158.0** (loaded via ESM from esm.sh)
- Vanilla JavaScript (ES6 modules)
- No build system - runs directly in browser
- WebGL with stencil buffer support

## Running the Project

Open [index.html](index.html) in a modern web browser with a local server (browsers block ES modules from `file://` URLs):

```bash
python3 -m http.server 8000
# Then open http://localhost:8000
```

Or use any static file server (Live Server extension in VS Code, etc.)

## Architecture

### Core Components

1. **[main.js](main.js)** - Entry point and render loop
   - Scene setup (chamber/room with colored walls)
   - Portal rendering pipeline using stencil buffer
   - Player collision and portal traversal logic
   - Physics updates for cube
   - Debug UI for toggling rendering steps

2. **[portal.js](portal.js)** - Portal class
   - Portal placement on surfaces
   - Virtual camera calculation for portal views
   - Oblique near-plane clipping (Eric Lengyel method)
   - Transform calculations for objects/player passing through portals
   - Rotation axis selection based on portal orientation (horizontal vs vertical)

3. **[controls.js](controls.js)** - FPSController class
   - First-person camera controls using Three.js PointerLockControls
   - WASD movement + spacebar jump
   - Velocity and gravity integration
   - Collision callback system

4. **[physics.js](physics.js)** - PhysicsCube class
   - Simple physics simulation with gravity
   - Collision detection with chamber bounds
   - Portal traversal for dynamic objects

### Portal Rendering Pipeline

The rendering uses a multi-step stencil buffer approach:

1. **Step 0**: Render main scene to color/depth buffers
2. **Step 1a**: Draw blue portal mask to stencil buffer (stencil=1)
3. **Step 1b**: Render scene from blue portal's virtual camera where stencil=1
4. **Step 2**: Draw orange portal mask (stencil=2) and render its view where stencil=2
5. **Step 3**: Render portal borders on top

Debug UI (toggle with `/` key) allows enabling/disabling each step to understand the pipeline.

### Portal Transform Math

Portals transform positions, orientations, and velocities through linked portal pairs:

- **Transform matrix**: `M_virtual = M_player * M_entry^-1 * M_exit * R_180`
- **Rotation axis selection**:
  - Horizontal portals (floor/ceiling): Rotate around portal's local X-axis
  - Vertical portals (walls): Rotate around portal's local Y-axis (always world-up)
- **Oblique clipping**: Modified projection matrix clips geometry behind exit portal surface

### Portal Traversal Triggers

- **Wall portals**: Triggered when moving toward portal (dot product of move direction and portal normal < -0.3)
- **Floor portals**: Triggered when moving toward OR falling (velocity.y < -1.0)
- **Ceiling portals**: Triggered when moving toward OR jumping up (velocity.y > 1.0)

After traversal through horizontal portals, player orientation is gradually corrected over 0.5s using quaternion slerp.

## Key Design Decisions

- **Stencil buffer over render-to-texture**: More efficient and avoids recursive rendering complexity
- **Oblique near-plane clipping**: Prevents rendering geometry behind the exit portal
- **Separate mask scene**: Portal masks rendered in separate scene to avoid affecting main scene depth
- **Material property preservation**: Original stencil properties saved and restored after portal view rendering
- **Orientation correction**: Smooth rotation interpolation after exiting horizontal portals improves UX

## Controls

- **Click**: Lock mouse pointer
- **WASD**: Move
- **Space**: Jump
- **Left Mouse**: Place blue portal
- **Right Mouse**: Place orange portal
- **ESC**: Unlock mouse pointer
- **/**: Toggle debug UI

## Code Conventions

- ES6 module imports from Three.js
- Classes extend Three.js objects (Group, Mesh)
- World-space transforms for portal math
- Helper methods return new objects (don't mutate input)

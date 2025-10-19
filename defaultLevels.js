/**
 * Default level definitions
 * These serve as templates that can be reset to at any time
 */

export const DEFAULT_LEVEL = {
  version: "1.0",
  name: "Default Level",

  // Player spawn configuration
  playerSpawn: {
    position: { x: 0, y: 1.0, z: 4 },
    rotation: { x: 0, y: 0, z: 0 },
    moved: false // Has the spawner been moved in editor?
  },

  // Default objects configuration (from levelBuilder and main.js)
  defaultObjects: {
    cube: {
      position: { x: 0, y: 2, z: 0 },
      visible: true
    },
    spawner: {
      position: { x: 0, y: 1.0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      moved: false
    },
    secondFloor: {
      visible: true,
      position: { x: -2.5, y: 5, z: -2.5 }
    },
    defaultDoor: {
      visible: true,
      position: { x: -2.5, y: 6, z: -2.5 },
      isExitDoor: true
    }
  },

  // Editor-placed objects (starts empty for default level)
  editorObjects: []
};

/**
 * Get a deep clone of the default level
 */
export function getDefaultLevel() {
  return JSON.parse(JSON.stringify(DEFAULT_LEVEL));
}

// Game configuration - all hardcoded values centralized here

export const CONFIG = {
  // Renderer settings
  renderer: {
    antialias: true,
    alpha: false,
    stencil: true,
    maxPixelRatio: 2,
    shadowsEnabled: true,
    backgroundColor: 0xffffff,
    clearColor: 0x444444,
  },

  // Camera settings
  camera: {
    fov: 75,
    near: 0.001,
    far: 200,
    startPosition: { x: 0, y: 1.6, z: 4 },
    rotationOrder: 'YXZ',
  },

  // Player/FPS Controller settings
  player: {
    eyeHeight: 1.6,
    minHeight: 1.0,
    radius: 0.2,
    startPosition: { x: 0, y: 1.0, z: 4 },
    groundedThreshold: 1.02,
  },

  // Room/Chamber settings
  room: {
    scale: 10,
    wallThickness: 0.2,
    colors: {
      back: 0xff4d4d,    // Red
      front: 0x4d79ff,   // Blue
      left: 0x4dff88,    // Green
      right: 0xffd24d,   // Yellow
      floor: 0xcccccc,   // Light gray
      ceiling: 0x999999, // Dark gray
      secondFloor: 0xdddddd,
      goal: 0xFF00FF,    // Magenta
    },
    secondFloorHeight: 5, // Half of room scale
    gridEnabled: true,
    gridDivisions: 10,
    gridOpacity: 0.5,
  },

  // Lighting settings
  lighting: {
    hemisphere: {
      skyColor: 0xffffff,
      groundColor: 0xaaaaaa,
      intensity: 0.8,
    },
    directional: {
      color: 0xffffff,
      intensity: 1.0,
      position: { x: 0, y: 10, z: 0 },
      shadowCameraNear: 0.1,
      shadowCameraFar: 20,
    },
  },

  // Portal settings
  portal: {
    blueColor: 0x2a7fff,
    orangeColor: 0xff7a00,
    placementMargin: 0.7,
    emissiveIntensity: 2,
    pulseDuration: 1200, // ms
    pulseInterval: 16,   // ms
  },

  // Portal traversal settings
  traversal: {
    horizontalThreshold: 0.7,  // dot product threshold for horizontal portals
    wallTriggerDistance: 1.5,  // multiplier of portal radius
    floorTriggerDistance: 1.2, // multiplier of portal radius
    orientationCorrectionDuration: 500, // ms
    playerOffsetDistance: 0.01,
    dotProductThreshold: {
      wall: -0.2,
      floor: -0.1,
      ceiling: -0.2,
    },
    floorApertureMultiplier: 1.15,
    ceilingVelocityThreshold: 0.5,
  },

  // Object interaction settings
  interaction: {
    grabCheckDistance: 3.0,
    grabDistance: 1.0,
    throwStrength: {
      min: 6.0,
      default: 15.0,
      max: 28.0,
    },
    chargeTiming: {
      deadzone: 300,  // ms before charging starts
      total: 1500,    // ms for full charge
    },
    grabLerpSpeed: 0.5,
  },

  // Physics settings
  physics: {
    cubeSize: 0.2,
    cubeStartPosition: { x: 0, y: 2, z: 0 },
  },

  // Goal/Level settings
  goal: {
    size: { x: 1, y: 2, z: 0.2 },
    triggerDistance: 1.2,
  },

  // Orientation correction settings
  orientation: {
    rollRecoverySpeed: 0.08,
    upRecoverySpeed: 0.08,
    maxAngleStep: 0.1,
  },

  // Animation settings
  animation: {
    maxDeltaTime: 0.05, // 50ms max frame time
  },

  // Debug settings
  debug: {
    defaultSteps: {
      stepA: false,
      stepB: false,
      step0: true,
      step1a: true,
      step1b: true,
      step2: true,
      step3: true,
    },
    toggleKey: '/',
  },

  // Mobile settings
  mobile: {
    lookSpeed: 1.2,
    joystickColor: 'black',
    joystickMode: 'dynamic',
    moveThreshold: 0.2,
  },

  // Render scale settings
  renderScale: {
    default: 1.0,
    storageKey: 'renderScale',
  },

  // Texture settings
  texture: {
    gridSize: 200,
    gridLineWidth: 4,
    gridColor: '#000000',
  },
};

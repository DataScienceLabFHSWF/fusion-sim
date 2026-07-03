import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export interface PostProcessingPipeline {
  composer: EffectComposer
  bloomPass: UnrealBloomPass
  resize: (width: number, height: number, pixelRatio: number) => void
}

/**
 * Set up the post-processing pipeline with bloom and tone mapping.
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostProcessingPipeline {
  const size = renderer.getSize(new THREE.Vector2())
  const composer = new EffectComposer(renderer)

  // Main render pass
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  // Bloom pass — selective bloom via emissive materials.
  // The threshold lets moderate-brightness plasma lines and glow sprites
  // bloom into a soft halo; strength/radius are tuned by eye against the
  // separatrix limb and strike-point glow.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(Math.ceil(size.x / 2), Math.ceil(size.y / 2)),
    0.7,   // strength — soft glow halo
    0.4,   // radius — spread of glow
    0.6,   // threshold — catch bright plasma lines + glow sprites
  )
  composer.addPass(bloomPass)

  // Output pass (gamma correction)
  const outputPass = new OutputPass()
  composer.addPass(outputPass)

  const resize = (width: number, height: number, pr: number) => {
    composer.setSize(width, height)
    composer.setPixelRatio(pr)
    bloomPass.resolution.set(Math.ceil(width / 2), Math.ceil(height / 2))
  }

  return { composer, bloomPass, resize }
}

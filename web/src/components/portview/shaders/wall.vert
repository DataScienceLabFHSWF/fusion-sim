// Wall tile vertex shader
// Passes UVs, normal, view direction, and region to the fragment shader.

attribute float a_region;

varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_viewDir;
varying vec3 v_worldPos;
varying float v_region;
varying float v_depth;

void main() {
  v_uv = uv;
  v_region = a_region;

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  v_worldPos = worldPos.xyz;
  v_normal = normalize(normalMatrix * normal);
  v_viewDir = normalize(cameraPosition - worldPos.xyz);

  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  v_depth = -mvPos.z; // positive depth into screen

  gl_Position = projectionMatrix * mvPos;
}

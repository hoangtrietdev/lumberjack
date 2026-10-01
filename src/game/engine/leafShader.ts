// Pure string patch for EZ-Tree's leaf vertex shader (see shareWindClock in trees.ts).
// Kept separate from three.js code so it can be unit-tested against the EZ-Tree source.

export const EZ_TREE_WIND_LINE = 'float windOffset = 2.0 * 3.14 * simplex3(mvPosition.xyz / uWindScale);';
export const EZ_TREE_PROJECT_LINE = 'mvPosition = modelViewMatrix * mvPosition;';

/** Makes EZ-Tree's custom <project_vertex> respect `instanceMatrix`. */
export function patchLeafInstancing(vs: string): string {
  const call = EZ_TREE_PROJECT_LINE;
  if (!vs.includes(call) || vs.includes('/*leaf-instancing*/')) return vs;
  return vs
    .replace(
      EZ_TREE_WIND_LINE,
      `float windOffset = 2.0 * 3.14 * simplex3(mvPosition.xyz / uWindScale);
        #ifdef USE_INSTANCING
          windOffset += dot(instanceMatrix[3].xz, vec2(0.37, 0.23)); // desync neighbouring trees
        #endif`,
    )
    .replace(
      call,
      `/*leaf-instancing*/
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        ${call}`,
    );
}

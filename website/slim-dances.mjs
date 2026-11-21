// slim-dances.mjs
// Makes the dance files tiny by removing the character's body (meshes,
// materials, textures) and keeping only the skeleton and the animation.
// The app already loads the body once from the character file, so the dance
// files only need their animation.
//
// HOW TO RUN (in the VS Code terminal, from the "website" folder):
//   npm install --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf
//   node slim-dances.mjs
//
// Your original files are copied to "Dances-backup" first, so nothing is lost.

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import fs from "fs";
import path from "path";

const DANCES_DIR = "Dances";
const BACKUP_DIR = "Dances-backup";
// The file the app uses for the character's body. This one is NOT slimmed.
const CHARACTER_FILE = path.join("Dances", "Magdalene", "shakastep.glb");

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });

function findGlbs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findGlbs(full);
    return entry.name.toLowerCase().endsWith(".glb") ? [full] : [];
  });
}

const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString()} KB`;

for (const file of findGlbs(DANCES_DIR)) {
  if (path.normalize(file) === path.normalize(CHARACTER_FILE)) {
    console.log(`skip   ${file}  (character body)`);
    continue;
  }

  const before = fs.statSync(file).size;

  // Back up the original once
  const backup = path.join(BACKUP_DIR, path.relative(DANCES_DIR, file));
  if (!fs.existsSync(backup)) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(file, backup);
  }

  const doc = await io.read(file);
  const root = doc.getRoot();

  if (!root.listAnimations().length) {
    console.log(`skip   ${file}  (no animation inside)`);
    continue;
  }

  // Keep every node (so bone names stay exactly the same), but drop the body
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  root.listMeshes().forEach((m) => m.dispose());
  root.listSkins().forEach((s) => s.dispose());
  root.listMaterials().forEach((m) => m.dispose());
  root.listTextures().forEach((t) => t.dispose());
  root.listExtensionsUsed().forEach((ext) => {
    if (ext.extensionName === "KHR_draco_mesh_compression") ext.dispose();
  });

  // Remove leftover data, but keep empty nodes (they're the bones)
  await doc.transform(prune({ keepLeaves: true, keepAttributes: false }));

  await io.write(file, doc);
  const after = fs.statSync(file).size;
  console.log(`slim   ${file}  ${kb(before)} → ${kb(after)}`);
}

console.log(`\nDone. Originals are in ${BACKUP_DIR}/`);

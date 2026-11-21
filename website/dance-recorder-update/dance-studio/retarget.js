// retarget.js
// Turns recorded MediaPipe body points into rotations for your character's bones.
//
// Usage:
//   import { createRetargeter, samplePoints } from "./retarget.js";
//   const rig = createRetargeter(gltf.scene);   // once, after loading the GLB
//   rig.applyPose(samplePoints(move, seconds)); // every frame
//
// It finds the bones by name automatically. It understands MPFB's "default"
// and "game engine" rigs, and Mixamo rigs. rig.report says what it matched.

import * as THREE from "three";

// MediaPipe's 33 body points (only the ones we use)
const P = {
  earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  pinkyL: 17, pinkyR: 18,
  indexL: 19, indexR: 20,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
  toeL: 31, toeR: 32
};

// Possible bone names for each body part. Names are compared in lowercase with
// dots, underscores, colons and spaces removed, so "upperarm01.L", "upperarm_l"
// and "mixamorig:LeftArm" all work. c = "l"/"r", w = "left"/"right".
const BONE_NAMES = {
  upperArm: (c, w) => [`upperarm01${c}`, `upperarm${c}`, `mixamorig${w}arm`, `${w}arm`, `${w}upperarm`],
  lowerArm: (c, w) => [`lowerarm01${c}`, `lowerarm${c}`, `forearm${c}`, `mixamorig${w}forearm`, `${w}forearm`, `${w}lowerarm`],
  hand: (c, w) => [`wrist${c}`, `hand${c}`, `mixamorig${w}hand`, `${w}hand`],
  upperLeg: (c, w) => [`upperleg01${c}`, `upperleg${c}`, `thigh${c}`, `mixamorig${w}upleg`, `${w}upleg`, `${w}thigh`],
  lowerLeg: (c, w) => [`lowerleg01${c}`, `lowerleg${c}`, `calf${c}`, `shin${c}`, `mixamorig${w}leg`, `${w}leg`, `${w}shin`],
  foot: (c, w) => [`foot${c}`, `mixamorig${w}foot`, `${w}foot`]
};
const HEAD_NAMES = ["head", "mixamorighead"];

const simplify = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function createRetargeter(model) {
  model.updateMatrixWorld(true);

  // ---------- 1. Find the bones ----------
  const allBones = [];
  model.traverse((o) => o.isBone && allBones.push(o));
  // A GLB with an armature but no body mesh loads its bones as plain objects,
  // so fall back to every non-mesh object in the file
  if (!allBones.length) {
    model.traverse((o) => o !== model && !o.isMesh && !o.isCamera && !o.isLight && allBones.push(o));
  }
  const isJoint = (o) => boneSet.has(o);
  const boneSet = new Set(allBones);
  const bySimpleName = new Map(allBones.map((b) => [simplify(b.name), b]));

  function findBone(candidates) {
    for (const c of candidates) if (bySimpleName.has(c)) return bySimpleName.get(c);
    // Fallback: allow a prefix such as "Human_" or "Armature" in front
    for (const c of candidates) {
      for (const [name, bone] of bySimpleName) if (name.endsWith(c)) return bone;
    }
    return null;
  }

  const bone = {};
  for (const [c, w, S] of [["l", "left", "L"], ["r", "right", "R"]]) {
    for (const part of Object.keys(BONE_NAMES)) {
      bone[part + S] = findBone(BONE_NAMES[part](c, w));
    }
  }
  bone.head = findBone(HEAD_NAMES);

  // The hips are wherever both legs join; the chest is wherever both arms join.
  // Working this out from the skeleton avoids guessing spine bone names.
  bone.hips = commonAncestor(bone.upperLegL, bone.upperLegR, boneSet);
  bone.chest = commonAncestor(bone.upperArmL, bone.upperArmR, boneSet);
  bone.neck = childTowards(bone.chest, bone.head, boneSet);

  const report = Object.entries(bone).map(([part, b]) => ({ part, bone: b ? b.name : null }));
  const missing = report.filter((r) => !r.bone).map((r) => r.part);

  // ---------- 2. Remember the starting (rest) pose ----------
  const used = [...new Set(Object.values(bone).filter(Boolean))];
  const restQuats = new Map(used.map((b) => [b, b.quaternion.clone()]));
  const restModelPos = model.position.clone();

  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const wq = (b) => b.getWorldQuaternion(new THREE.Quaternion());
  const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
  const toLocal = (b, v) => v.clone().normalize().applyQuaternion(wq(b).invert());

  // Where a bone "points" in its own space: towards the next joint
  function aimSetup(b, endWorld) {
    if (!b || !endWorld) return null;
    return { bone: b, dirLocal: toLocal(b, endWorld.clone().sub(wp(b))) };
  }

  // For bones whose sideways direction matters too (hips, chest, head)
  function basisSetup(b, sideWorld, upWorld) {
    if (!b) return null;
    return { bone: b, sideLocal: toLocal(b, sideWorld), upLocal: toLocal(b, upWorld) };
  }

  function childrenCentre(b) {
    const kids = b ? b.children.filter(isJoint) : [];
    if (!kids.length) return null;
    const c = new THREE.Vector3();
    kids.forEach((k) => c.add(wp(k)));
    return c.divideScalar(kids.length);
  }

  const ok = (...bs) => bs.every(Boolean);
  const setups = {};

  if (ok(bone.upperLegL, bone.upperLegR, bone.upperArmL, bone.upperArmR)) {
    const legsMid = mid(wp(bone.upperLegL), wp(bone.upperLegR));
    const armsMid = mid(wp(bone.upperArmL), wp(bone.upperArmR));
    const torsoUp = armsMid.clone().sub(legsMid);
    const restLeft = wp(bone.upperLegL).sub(wp(bone.upperLegR));

    setups.hips = basisSetup(bone.hips, restLeft, torsoUp);
    setups.chest = basisSetup(bone.chest, wp(bone.upperArmL).sub(wp(bone.upperArmR)), torsoUp);
    if (ok(bone.neck, bone.head)) {
      setups.neck = aimSetup(bone.neck, wp(bone.head));
      setups.head = basisSetup(bone.head, restLeft, wp(bone.head).sub(wp(bone.neck)));
    }
  }

  for (const S of ["L", "R"]) {
    setups["upperArm" + S] = aimSetup(bone["upperArm" + S], bone["lowerArm" + S] && wp(bone["lowerArm" + S]));
    setups["lowerArm" + S] = aimSetup(bone["lowerArm" + S], bone["hand" + S] && wp(bone["hand" + S]));
    setups["hand" + S] = aimSetup(bone["hand" + S], childrenCentre(bone["hand" + S]));
    setups["upperLeg" + S] = aimSetup(bone["upperLeg" + S], bone["lowerLeg" + S] && wp(bone["lowerLeg" + S]));
    setups["lowerLeg" + S] = aimSetup(bone["lowerLeg" + S], bone["foot" + S] && wp(bone["foot" + S]));
    setups["foot" + S] = aimSetup(bone["foot" + S], childrenCentre(bone["foot" + S]));
  }

  // Lowest point of the feet in the rest pose = the floor
  const footBones = [bone.footL, bone.footR, bone.lowerLegL, bone.lowerLegR].filter(Boolean);
  const lowestFootY = () => {
    let min = Infinity;
    for (const b of footBones) {
      min = Math.min(min, wp(b).y);
      for (const k of b.children) if (isJoint(k)) min = Math.min(min, wp(k).y);
    }
    return min;
  };
  const restFloorY = footBones.length ? lowestFootY() : 0;

  // ---------- 3. Posing ----------
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();

  function basisQuat(side, up) {
    const x = side.clone().normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(tmpM.makeBasis(x, y, z));
  }

  // Rotate a bone so its "side" and "up" match the targets
  function applyBasis(s, side, up) {
    if (!s) return;
    const world = basisQuat(side, up).multiply(basisQuat(s.sideLocal, s.upLocal).invert());
    setWorldRotation(s.bone, world);
  }

  // Rotate a bone so it points at the target direction
  function applyAim(s, target) {
    if (!s) return;
    const current = wq(s.bone);
    const currentDir = s.dirLocal.clone().applyQuaternion(current);
    const swing = tmpQ.setFromUnitVectors(currentDir, target.clone().normalize());
    setWorldRotation(s.bone, swing.clone().multiply(current));
  }

  function setWorldRotation(b, world) {
    const parentWorld = b.parent ? wq(b.parent) : new THREE.Quaternion();
    b.quaternion.copy(parentWorld.invert().multiply(world));
    b.updateMatrixWorld(true);
  }

  // points: 33 entries of [x, y, z] in MediaPipe world space (metres, y down)
  function applyPose(points) {
    // MediaPipe: y points down and z points away from the camera.
    // Three.js: y points up and the character faces the camera (+z).
    const p = (i) => new THREE.Vector3(points[i][0], -points[i][1], -points[i][2]);
    const between = (a, b) => p(b).sub(p(a));

    // Start from the rest pose every frame
    for (const [b, q] of restQuats) b.quaternion.copy(q);
    model.position.copy(restModelPos);
    model.updateMatrixWorld(true);

    const hipsMid = mid(p(P.hipL), p(P.hipR));
    const shouldersMid = mid(p(P.shoulderL), p(P.shoulderR));
    const torsoUp = shouldersMid.clone().sub(hipsMid);

    // Parents first, then children
    applyBasis(setups.hips, between(P.hipR, P.hipL), torsoUp);
    applyBasis(setups.chest, between(P.shoulderR, P.shoulderL), torsoUp);

    const earsMid = mid(p(P.earL), p(P.earR));
    applyAim(setups.neck, earsMid.clone().sub(shouldersMid));
    applyBasis(setups.head, between(P.earR, P.earL), earsMid.clone().sub(shouldersMid));

    for (const S of ["L", "R"]) {
      applyAim(setups["upperArm" + S], between(P["shoulder" + S], P["elbow" + S]));
      applyAim(setups["lowerArm" + S], between(P["elbow" + S], P["wrist" + S]));
      const fingers = mid(p(P["pinky" + S]), p(P["index" + S]));
      applyAim(setups["hand" + S], fingers.sub(p(P["wrist" + S])));

      applyAim(setups["upperLeg" + S], between(P["hip" + S], P["knee" + S]));
      applyAim(setups["lowerLeg" + S], between(P["knee" + S], P["ankle" + S]));
      applyAim(setups["foot" + S], between(P["ankle" + S], P["toe" + S]));
    }

    // MediaPipe centres everything on the hips, so keep the feet on the floor
    if (footBones.length) {
      model.position.y += restFloorY - lowestFootY();
      model.updateMatrixWorld(true);
    }
  }

  function resetPose() {
    for (const [b, q] of restQuats) b.quaternion.copy(q);
    model.position.copy(restModelPos);
    model.updateMatrixWorld(true);
  }

  return {
    applyPose,
    resetPose,
    report,            // [{ part, bone }] – which bone was used for each body part
    missing,           // body parts it couldn't find
    allBoneNames: allBones.map((b) => b.name),
    joints: allBones   // every bone/joint object, e.g. for drawing the skeleton
  };
}

// Get the body points at any moment of a recorded move, blending between
// the two nearest frames so playback is smooth.
export function samplePoints(move, seconds) {
  const frames = move.frames;
  if (seconds <= frames[0].t) return frames[0].points;
  const last = frames[frames.length - 1];
  if (seconds >= last.t) return last.points;

  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (frames[m].t <= seconds) lo = m;
    else hi = m;
  }
  const a = frames[lo];
  const b = frames[hi];
  const k = (seconds - a.t) / (b.t - a.t);
  return a.points.map((pa, i) => {
    const pb = b.points[i];
    return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k];
  });
}

// Smooth out webcam jitter. Each point is averaged with its neighbours in time
// (a "Gaussian" blur over time). `seconds` = how much to smooth; 0.05 is light.
export function smoothMove(move, seconds = 0.05) {
  const frames = move.frames;
  const reach = seconds * 3;
  const smoothed = frames.map((frame, i) => {
    const totals = frame.points.map(() => [0, 0, 0]);
    let weightSum = 0;
    for (let j = i; j >= 0 && frame.t - frames[j].t <= reach; j--) add(j);
    for (let j = i + 1; j < frames.length && frames[j].t - frame.t <= reach; j++) add(j);

    function add(j) {
      const dt = frames[j].t - frame.t;
      const w = Math.exp(-(dt * dt) / (2 * seconds * seconds));
      weightSum += w;
      frames[j].points.forEach((p, k) => {
        totals[k][0] += p[0] * w;
        totals[k][1] += p[1] * w;
        totals[k][2] += p[2] * w;
      });
    }

    const points = totals.map((s, k) => [
      Math.round((s[0] / weightSum) * 10000) / 10000,
      Math.round((s[1] / weightSum) * 10000) / 10000,
      Math.round((s[2] / weightSum) * 10000) / 10000,
      frame.points[k][3]
    ]);
    return { ...frame, points };
  });
  return { ...move, frames: smoothed };
}

// Flip the points left-to-right, so the character copies you like a mirror
const MIRROR_PAIRS = [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]];
export function mirrorPoints(points) {
  const out = points.map((p) => [-p[0], p[1], p[2]]);
  for (const [a, b] of MIRROR_PAIRS) [out[a], out[b]] = [out[b], out[a]];
  return out;
}

// ---------- Skeleton helpers ----------
function ancestors(b, joints) {
  const list = [];
  for (let o = b; o && joints.has(o); o = o.parent) list.push(o);
  return list;
}

function commonAncestor(a, b, joints) {
  if (!a || !b) return null;
  const set = new Set(ancestors(a, joints));
  for (const o of ancestors(b, joints)) if (set.has(o) && o !== a && o !== b) return o;
  return null;
}

// The child of `from` that leads down to `to`
function childTowards(from, to, joints) {
  if (!from || !to) return null;
  const chain = ancestors(to, joints);
  const i = chain.indexOf(from);
  return i > 0 ? chain[i - 1] : null;
}

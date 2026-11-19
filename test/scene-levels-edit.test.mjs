/**
 * Unit tests for floor editing (scripts/scene-levels-edit.js) and the
 * start-floor lookup (scripts/levels.js), against a stand-in Scene.
 *
 * The stand-in mirrors the two shapes that matter: a scene whose floors are
 * embedded Level documents (edited one at a time), and an older shape where
 * floors are one array on the scene.
 *
 *   Run:  node test/scene-levels-edit.test.mjs
 */

const warnings = [];
const errors = [];
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k } };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m), error: (m) => errors.push(m) } };
let nextId = 0;
globalThis.foundry = {
  utils: {
    deepClone: (o) => structuredClone(o),
    randomID: () => `new${nextId++}`,
    mergeObject: (a, b) => ({ ...a, ...b, elevation: { ...a.elevation, ...b.elevation }, background: { ...a.background, ...b.background } })
  }
};

const { getInitialLevelId, getCurrentLevelId } = await import("../scripts/levels.js");
const { updateLevel, moveLevel, setStartLevel, replaceLevelImage, addLevel, removeLevel } =
  await import("../scripts/scene-levels-edit.js");

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}  ${detail}`); }
}

const floor = (id, name, bottom, top, sort) => ({
  _id: id, name, elevation: { bottom, top }, background: { src: `${id}.webp`, color: "#000000" }, sort
});

/** A scene whose floors are embedded Level documents, as on Foundry v14. */
function embeddedScene() {
  const docs = [floor("a", "Ground", 0, 10, 0), floor("b", "Upper", 11, 20, 1), floor("c", "Attic", 21, 30, 2)]
    .map((d) => ({ ...d, id: d._id, toObject() { const { toObject, id, ...rest } = this; return structuredClone(rest); } }));
  const calls = [];
  const scene = {
    constructor: { metadata: { embedded: { Level: "levels" } } },
    levels: { get contents() { return docs; } },
    _source: { initialLevel: "a" },
    // v14 hands the start floor back as the Level itself, not its id.
    get initialLevel() { return docs.find((d) => d._id === this._source.initialLevel) ?? null; },
    calls,
    async update(data) {
      calls.push(["update", data]);
      if ("levels" in data) throw new Error("a whole-array write must not reach a scene with embedded floors");
      if (data.initialLevel) this._source.initialLevel = data.initialLevel;
    },
    async updateEmbeddedDocuments(type, changes) {
      calls.push(["updateEmbedded", type, changes]);
      for (const c of changes) {
        const d = docs.find((x) => x._id === c._id);
        if (c.name) d.name = c.name;
        if (c.elevation) d.elevation = { ...c.elevation };
        if (c.sort !== undefined) d.sort = c.sort;
        if (c.background) d.background = { ...d.background, ...c.background };
      }
    },
    async createEmbeddedDocuments(type, data) {
      calls.push(["createEmbedded", type, data]);
      return data.map((d) => {
        const doc = { ...d, _id: `made${nextId}`, id: `made${nextId++}`, toObject() { return structuredClone({ ...d, _id: this._id }); } };
        docs.push(doc);
        return doc;
      });
    },
    async deleteEmbeddedDocuments(type, ids) {
      calls.push(["deleteEmbedded", type, ids]);
      for (const id of ids) docs.splice(docs.findIndex((d) => d._id === id), 1);
    }
  };
  return { scene, docs };
}

/** An older-shaped scene: floors are one plain array written back whole. */
function arrayScene() {
  const scene = {
    levels: [floor("a", "Ground", 0, 10, 0), floor("b", "Upper", 11, 20, 1)],
    initialLevel: "a",
    async update(data) {
      if (data.levels) this.levels = data.levels;
      if (data.initialLevel) this.initialLevel = data.initialLevel;
    }
  };
  return scene;
}

console.log("A: the start floor is read as an id, whichever shape the scene hands back");
{
  const { scene } = embeddedScene();
  check("embedded scene -> stored id", getInitialLevelId(scene) === "a", String(getInitialLevelId(scene)));
  check("a Level document with no stored id -> its id", getInitialLevelId({ initialLevel: { id: "x" } }) === "x");
  check("a plain id -> itself", getInitialLevelId({ initialLevel: "y" }) === "y");
  check("nothing set -> null", getInitialLevelId({}) === null && getInitialLevelId(null) === null);
  check("current floor falls back to the start floor", getCurrentLevelId(scene) === "a", String(getCurrentLevelId(scene)));
}

console.log("B: edits on a v14 scene name only the floor they touch");
{
  const { scene, docs } = embeddedScene();
  check("rename reports success", await updateLevel(scene, "b", { name: "  First Floor " }) === true);
  check("rename is one embedded update of one floor",
    scene.calls.length === 1 && scene.calls[0][0] === "updateEmbedded" && scene.calls[0][2].length === 1 && scene.calls[0][2][0].name === "First Floor",
    JSON.stringify(scene.calls));
  scene.calls.length = 0;
  check("an unchanged save writes nothing", await updateLevel(scene, "b", { name: "First Floor", bottom: 11, top: 20 }) === true && scene.calls.length === 0);
  check("a reversed elevation is ignored", await updateLevel(scene, "b", { bottom: 30, top: 5 }) === true && scene.calls.length === 0);
  await moveLevel(scene, "a", +1);
  const a = docs.find((d) => d._id === "a"), b = docs.find((d) => d._id === "b");
  check("moving up swaps the two floors' heights", a.elevation.bottom === 11 && b.elevation.bottom === 0, JSON.stringify([a.elevation, b.elevation]));
  check("moving past the top is refused", await moveLevel(scene, "c", +1) === false);
  await replaceLevelImage(scene, "c", "new.webp");
  check("replace image keeps the floor and its colour", docs.find((d) => d._id === "c").background.src === "new.webp" && docs.find((d) => d._id === "c").background.color === "#000000");
}

console.log("C: add and remove on a v14 scene");
{
  const { scene, docs } = embeddedScene();
  const id = await addLevel(scene, { name: "Roof", src: "roof.webp" });
  const made = docs.find((d) => d._id === id);
  check("add returns the new floor's id", typeof id === "string" && !!made, String(id));
  check("the new floor sits above the old top floor", made?.elevation.bottom === 31 && made?.elevation.top === 41, JSON.stringify(made?.elevation));
  check("add creates one Level and never rewrites the others", scene.calls.length === 1 && scene.calls[0][0] === "createEmbedded" && scene.calls[0][1] === "Level");
  scene.calls.length = 0;
  check("removing the start floor reports success", await removeLevel(scene, "a") === true);
  check("the start floor moves to a surviving floor first",
    scene.calls[0][0] === "update" && scene.calls[0][1].initialLevel === "b" && scene.calls[1][0] === "deleteEmbedded",
    JSON.stringify(scene.calls));
  check("the floor is gone", !docs.some((d) => d._id === "a") && docs.length === 3);
  scene.calls.length = 0;
  await removeLevel(scene, "c");
  check("removing another floor leaves the start floor alone", scene.calls.length === 1 && scene.calls[0][0] === "deleteEmbedded");
  await setStartLevel(scene, id);
  check("set start floor stores the id", scene._source.initialLevel === id);
  check("an unknown floor is refused", await removeLevel(scene, "nope") === false && await setStartLevel(scene, "nope") === false);
}

console.log("D: the last floor is kept, and a failed write is reported, not thrown");
{
  const { scene, docs } = embeddedScene();
  await removeLevel(scene, "c");
  await removeLevel(scene, "b");
  warnings.length = 0;
  check("the last floor cannot be removed", await removeLevel(scene, "a") === false && docs.length === 1 && warnings.length === 1);
  scene.updateEmbeddedDocuments = async () => { throw new Error("server said no"); };
  errors.length = 0;
  const origError = console.error;
  console.error = () => {};
  let result;
  try { result = await updateLevel(scene, "a", { name: "Cellar" }); } finally { console.error = origError; }
  check("a rejected write returns false with a message", result === false && errors.length === 1, JSON.stringify([result, errors]));
  check("the next edit still runs", await updateLevel(scene, "a", { name: "Ground" }) === true);
}

console.log("E: a scene without embedded floors still gets the whole-array write");
{
  const scene = arrayScene();
  await updateLevel(scene, "b", { name: "Loft" });
  check("rename keeps both floors and their ids", scene.levels.map((l) => l._id).join() === "a,b" && scene.levels[1].name === "Loft", JSON.stringify(scene.levels));
  const id = await addLevel(scene, { name: "Roof" });
  check("add appends a floor with an id", scene.levels.length === 3 && scene.levels[2]._id === id);
  await removeLevel(scene, "a");
  check("remove drops the floor and re-points the start floor", scene.levels.length === 2 && scene.initialLevel === "b", JSON.stringify([scene.levels.length, scene.initialLevel]));
}

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

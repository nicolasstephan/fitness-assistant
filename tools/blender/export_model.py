"""Export web-ready muscle + skeleton models from the Z-Anatomy Startup.blend.

Usage (Blender 4.x/5.x, headless):
    blender -b --disable-autoexec <path>/Startup.blend --python tools/blender/export_model.py -- <out_dir>

Produces:
    <out_dir>/muscles.glb   one node per muscle, extras: {"muscle": "<name>", "side": "l"|"r"|""}
    <out_dir>/skeleton.glb  all bones merged into a single decimated mesh

Source model: Z-Anatomy (CC BY-SA 4.0), based on BodyParts3D (CC BY-SA 2.1 JP).
"""
import re
import sys

import bpy

OUT_DIR = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "."

# Structures that are not useful for a training view (connective tissue, internal organs' muscles).
EXCLUDE_KEYWORDS = [
    "bursa", "fascia", "sheath", "septum", "retinacul", "aponeurosis", "ligament", "tarsus",
    "trochlea", "tendinous ring", "linea alba", "tendinous arch", "iliopectineal arch",
]
KEEP_ANYWAY = {
    "Epicranial aponeurosis",  # covers the skull, keeps the head shape
    "Tensor fasciae latae",
}
EXCLUDE_NAMES = {
    # eye
    "Lateral rectus muscle", "Medial rectus muscle", "Superior rectus muscle", "Inferior rectus muscle",
    "Superior oblique muscle", "Inferior oblique muscle", "Levator palpebrae superioris",
    # tongue, palate, pharynx, larynx
    "Hyoglossus muscle", "Genioglossus muscle", "Palatopharyngeus muscle",
    "Superior pharyngeal constrictor", "Middle pharyngeal constrictor", "Inferior pharyngeal constrictor",
    "Stylopharyngeus muscle", "Oblique part of cricothyroid muscle", "Straight part of cricothyroid muscle",
    "External part of thyro-arytenoid muscle", "Ary-epiglottic part of oblique arytenoid muscle",
    "Thyro-epiglottic part of thyro-arytenoid muscle", "Transverse arytenoid muscle",
    "Lateral crico-arytenoid muscle", "Posterior crico-arytenoid muscle",
    # thoracic / pelvic interior
    "Internal intercostal muscles", "Innermost intercostal muscles", "Transversus thoracis muscle",
    "Diaphragm", "Coccygeus muscle", "Iliococcygeus muscle", "Pubo-analis muscle", "Pubococcygeus muscle",
    "External anal sphincter",
}

SIDE_RE = re.compile(r"^(.*)\.([lr])$")
LABEL_RE = re.compile(r"\.[gjt]$")  # Z-Anatomy label/group helper objects


def split_name(name):
    m = SIDE_RE.match(name)
    base, side = (m.group(1), m.group(2)) if m else (name, "")
    return base.strip(), side


def muscle_wanted(base):
    if base in KEEP_ANYWAY:
        return True
    if base in EXCLUDE_NAMES:
        return False
    low = base.lower()
    return not any(k in low for k in EXCLUDE_KEYWORDS)


def decimate_ratio(tris):
    if tris > 8000:
        return 0.15
    if tris > 3000:
        return 0.25
    if tris > 1200:
        return 0.4
    if tris > 500:
        return 0.65
    return 1.0


def find_collection(prefix):
    return next(c for c in bpy.data.collections if c.name.startswith(prefix))


def all_objects(col):
    seen = set()
    stack = [col]
    while stack:
        c = stack.pop()
        for o in c.objects:
            if o.name not in seen:
                seen.add(o.name)
                yield o
        stack.extend(c.children)


def baked_mesh(obj, depsgraph, ratio, name):
    """World-space, modifier-applied, decimated copy of obj's mesh."""
    if ratio < 1.0:
        mod = obj.modifiers.new("web_decimate", "DECIMATE")
        mod.ratio = ratio
        depsgraph.update()
    ev = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(ev)
    mesh.name = name
    mw = obj.matrix_world
    mesh.transform(mw)
    if mw.determinant() < 0:
        mesh.flip_normals()
    if ratio < 1.0:
        obj.modifiers.remove(mod)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return mesh


def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def isolate(scene, collection):
    for c in list(scene.collection.children):
        scene.collection.children.unlink(c)
    for o in list(scene.collection.objects):
        scene.collection.objects.unlink(o)
    scene.collection.children.link(collection)


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_active_scene=True,
        export_extras=True,
        export_materials="NONE",
        export_texcoords=False,
        export_normals=True,
        export_apply=False,
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )


def main():
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()

    # --- muscles: one object per muscle and side
    muscles_col = bpy.data.collections.new("web_muscles")
    total_in = total_out = 0
    for obj in all_objects(find_collection("4: Muscular system")):
        if obj.type != "MESH" or len(obj.data.polygons) == 0:
            continue
        if LABEL_RE.search(obj.name):
            continue
        base, side = split_name(obj.name)
        if not muscle_wanted(base):
            continue
        tris = tri_count(obj.data)
        mesh = baked_mesh(obj, depsgraph, decimate_ratio(tris), obj.name)
        new = bpy.data.objects.new(obj.name, mesh)
        new["muscle"] = base
        new["side"] = side
        muscles_col.objects.link(new)
        total_in += tris
        total_out += tri_count(mesh)
    print(f"[export] muscles: {len(muscles_col.objects)} objects, {total_in} -> {total_out} tris")

    # --- skeleton: everything merged into one mesh
    skel_col = bpy.data.collections.new("web_skeleton")
    parts = []
    for obj in all_objects(find_collection("1: Skeletal system")):
        if obj.type != "MESH" or len(obj.data.polygons) == 0 or LABEL_RE.search(obj.name):
            continue
        mesh = baked_mesh(obj, depsgraph, 0.2, obj.name)
        part = bpy.data.objects.new(obj.name, mesh)
        skel_col.objects.link(part)
        parts.append(part)
    with bpy.context.temp_override(active_object=parts[0], selected_editable_objects=parts,
                                   selected_objects=parts, object=parts[0]):
        bpy.ops.object.join()
    parts[0].name = parts[0].data.name = "Skeleton"
    print(f"[export] skeleton: {len(parts)} parts -> {tri_count(parts[0].data)} tris")

    isolate(scene, muscles_col)
    export(f"{OUT_DIR}/muscles.glb")
    isolate(scene, skel_col)
    export(f"{OUT_DIR}/skeleton.glb")
    print("[export] done")


main()

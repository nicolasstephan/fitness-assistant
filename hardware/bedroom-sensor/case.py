#! python3
# Bedroom sensor case (Rhino 8, CPython). Parametric: change the numbers below, run again.
#   Rhino: ScriptEditor > open this file > Run   (or: _-RunPythonScript <path>)
# Builds three printable parts and a preview with dummy boards:
#   shell    tower with two chambers: SCD41 below (vented, away from the ESP32's heat), electronics above
#   divider  plate between the chambers (rests on a ledge); XIAO ESP32C3 pocket on top, wire notch
#   lid      top cap with a friction lip, light window and a BH1750 pocket underneath
# Output next to this file: case.3dm, stl/<part>.stl (print orientation), preview.png, build.log
# All sizes in mm. Board sizes are from the data sheets; measure the real boards and adjust.
import os, math, struct, traceback
import Rhino
import Rhino.Geometry as G
import scriptcontext as sc
import System.Drawing as SD

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "build.log")

# ---------------------------------------------------------------- parameters
WALL = 2.0
IN_W, IN_D = 40.0, 32.0          # inner width (x) and depth (y)
OUT_R = 4.0                       # outer corner radius
SHELL_H = 78.0                    # shell height (lid adds 2 mm on top)
FLOOR = 2.0
DIV_Z = 30.0                      # top of the ledge = bottom of the divider plate
DIV_T = 2.0                       # divider plate thickness
FIT = 0.3                         # clearance for sliding fits
LID_T, LIP_H, LIP_W = 2.0, 3.0, 1.4

# boards (w = along x, h = height / length, t = PCB thickness)
SCD_W, SCD_H, SCD_T = 24.0, 21.0, 1.6      # Pimoroni SCD41, stands upright, sensor facing the front vents
XIAO_W, XIAO_L, XIAO_X = 17.8, 21.0, -8.0  # XIAO ESP32C3 (Seeed: 21 x 17.8 mm) lying flat, USB-C to the back wall
XIAO_T = 1.2                                # XIAO PCB thickness
USB_W, USB_H, USB_Z = 13.0, 8.0, 2.8       # opening for the USB-C plug (Z = its centre above the divider top)
MIC_W, MIC_H, MIC_X = 16.5, 12.7, 9.0      # Adafruit SPH0645, flat against the front wall
MIC_HOLE_W, MIC_HOLE_H = 2.5, 6.0          # sound slot through the front wall at the board's centre
BH_W, BH_D = 18.5, 13.9                    # GY-302 (BH1750) under the lid
BH_GAP = 1.5                                # board sits this far below the lid (room for its top-side parts)
WINDOW_D = 7.0                              # light window in the lid

TOL = 0.01
OX, OY = IN_W / 2 + WALL, IN_D / 2 + WALL   # outer half sizes
IX, IY = IN_W / 2, IN_D / 2                 # inner half sizes
DIV_TOP = DIV_Z + DIV_T

# ---------------------------------------------------------------- helpers
def box(x0, x1, y0, y1, z0, z1):
    return G.Box(G.BoundingBox(G.Point3d(min(x0, x1), min(y0, y1), min(z0, z1)),
                               G.Point3d(max(x0, x1), max(y0, y1), max(z0, z1)))).ToBrep()

def rprism(w, d, r, z0, z1, cx=0.0, cy=0.0):
    """Rounded-rectangle prism, w x d, corner radius r, from z0 to z1."""
    rect = G.Rectangle3d(G.Plane(G.Point3d(cx, cy, z0), G.Vector3d.ZAxis),
                         G.Interval(-w / 2, w / 2), G.Interval(-d / 2, d / 2))
    crv = rect.ToNurbsCurve()
    if r > 0:
        f = G.Curve.CreateFilletCornersCurve(crv, r, TOL, math.radians(1))
        if f: crv = f
    srf = G.Surface.CreateExtrusion(crv, G.Vector3d(0, 0, z1 - z0))
    b = srf.ToBrep().CapPlanarHoles(TOL)
    if b.SolidOrientation == G.BrepSolidOrientation.Inward:
        b.Flip()   # the curve's direction can leave the normals pointing in; booleans need them out
    return b

def cyl(x, y, z0, z1, d):
    pl = G.Plane(G.Point3d(x, y, z0), G.Vector3d.ZAxis)
    return G.Cylinder(G.Circle(pl, d / 2), z1 - z0).ToBrep(True, True)

def largest(breps):
    return max(breps, key=lambda b: abs(G.VolumeMassProperties.Compute(b).Volume))

def diff(a, cutters, what="part"):
    """Cut one cutter at a time (a failing cutter is logged and skipped, not fatal)."""
    for i, c in enumerate(cutters):
        r = G.Brep.CreateBooleanDifference(a, c, TOL)
        if r and len(r):
            a = largest(r)
        else:
            log("WARNING: %s cut %d failed (bbox %s)" % (what, i, c.GetBoundingBox(True).ToString()))
    return a

def union(parts):
    r = G.Brep.CreateBooleanUnion(list(parts), TOL)
    if not r: raise RuntimeError("boolean union failed")
    return largest(r) if len(r) > 1 else r[0]

def log(msg):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")

# ---------------------------------------------------------------- shell
def make_shell():
    shell = diff(rprism(2 * OX, 2 * OY, OUT_R, 0, SHELL_H),
                 [rprism(IN_W, IN_D, OUT_R - WALL, FLOOR, SHELL_H + 1)])
    adds = []
    # ledge ring carrying the divider plate
    adds.append(diff(rprism(IN_W + 1, IN_D + 1, OUT_R - WALL, DIV_Z - 2, DIV_Z),
                     [rprism(IN_W - 4, IN_D - 4, 1, DIV_Z - 3, DIV_Z + 1)]))
    # SCD41 posts with a groove each (board upright in the XZ plane, centred at y = 0)
    g = SCD_T + FIT
    for s in (-1, 1):
        x_in, x_out = s * (SCD_W / 2 - 2.0), s * (SCD_W / 2 + FIT + 2.0)
        post = box(x_in, x_out, -3, 3, FLOOR - 0.5, FLOOR + 12)
        groove = box(x_in - s * 1, s * (SCD_W / 2 + FIT), -g / 2, g / 2, FLOOR, FLOOR + 13)
        adds.append(diff(post, [groove]))
    # mic retainers on the front wall: board flat against the wall, held by two L-ribs
    gap = SCD_T + FIT + 0.1
    for s in (-1, 1):
        edge = MIC_X + s * (MIC_W / 2 + FIT / 2)
        rib = box(edge, edge + s * 2.0, -IY - 0.5, -IY + gap + 1.6, DIV_TOP, DIV_TOP + MIC_H + 4)
        lip = box(edge - s * 1.4, edge + s * 0.01, -IY + gap, -IY + gap + 1.6, DIV_TOP, DIV_TOP + MIC_H + 4)
        adds.append(union([rib, lip]))
    shell = union([shell] + adds)

    cuts = []
    # lower chamber: vents on all four sides and in the floor (sensor air)
    for z in (7, 12, 17, 22):
        cuts.append(box(-15, 15, -OY - 1, -IY + 1, z, z + 2))          # front
        cuts.append(box(-15, 15, IY - 1, OY + 1, z, z + 2))            # back
        cuts.append(box(-OX - 1, -IX + 1, -11, 11, z, z + 2))          # left
        cuts.append(box(IX - 1, OX + 1, -11, 11, z, z + 2))            # right
    for y in (-9, 9):
        cuts.append(box(-8, 8, y - 1, y + 1, -1, FLOOR + 1))           # floor
    # upper chamber: a few slots high up to let the ESP32's heat out
    for z in (64, 68, 72):
        cuts.append(box(-12, 12, IY - 1, OY + 1, z, z + 2))
        cuts.append(box(-OX - 1, -IX + 1, -8, 8, z, z + 2))
        cuts.append(box(IX - 1, OX + 1, -8, 8, z, z + 2))
    # USB-C opening in the back wall, in line with the XIAO's connector
    uz = DIV_TOP + USB_Z
    cuts.append(box(XIAO_X - USB_W / 2, XIAO_X + USB_W / 2, IY - 1, OY + 1, uz - USB_H / 2, uz + USB_H / 2))
    # sound slot through the front wall at the mic board's centre
    mz = DIV_TOP + MIC_H / 2
    cuts.append(box(MIC_X - MIC_HOLE_W / 2, MIC_X + MIC_HOLE_W / 2, -OY - 1, -IY + 0.5, mz - MIC_HOLE_H / 2, mz + MIC_HOLE_H / 2))
    return diff(shell, cuts, "shell")

# ---------------------------------------------------------------- divider plate (local z 0..DIV_T)
def make_divider():
    w, d = IN_W - 2 * FIT, IN_D - 2 * FIT
    plate = rprism(w, d, OUT_R - WALL - FIT, 0, DIV_T)
    # notch for the sensor wires (right side, next to the SCD41)
    plate = diff(plate, [box(IX - 7, IX + 1, -4, 4, -1, DIV_T + 1)])
    # XIAO pocket: open towards the back so the USB-C connector reaches the wall
    y_back = IY - 1.5                    # back edge of the board (connector overhangs ~1 mm)
    y_front = y_back - XIAO_L
    hw = XIAO_W / 2 + FIT
    frame = box(XIAO_X - hw - 1.2, XIAO_X + hw + 1.2, y_front - FIT - 1.2, y_back, DIV_T - 0.01, DIV_T + 1.2)
    frame = diff(frame, [box(XIAO_X - hw, XIAO_X + hw, y_front - FIT, y_back + 1, DIV_T - 1, DIV_T + 2)])
    return union([plate, frame])

# ---------------------------------------------------------------- lid (local z: plate 0..LID_T, lip below 0)
def make_lid():
    plate = rprism(2 * OX, 2 * OY, OUT_R, 0, LID_T)
    lw, ld = IN_W - 2 * FIT, IN_D - 2 * FIT
    lip = diff(rprism(lw, ld, OUT_R - WALL - FIT, -LIP_H, 0.01),
               [rprism(lw - 2 * LIP_W, ld - 2 * LIP_W, 0.8, -LIP_H - 1, 0.5)])
    # BH1750 pocket under the window (board pressed in, or a dab of hot glue)
    bw, bd = BH_W / 2 + FIT, BH_D / 2 + FIT
    depth = BH_GAP + 1.6 + 0.6
    frame = diff(box(-bw - 1.2, bw + 1.2, -bd - 1.2, bd + 1.2, -depth, 0.01),
                 [box(-bw, bw, -bd, bd, -depth - 1, 0.5)])
    # two ribs at the short ends: the board rests on its edges, BH_GAP below the lid
    ribs = [box(s * (bw + 0.6), s * (bw - 1.0), -bd - 0.6, bd + 0.6, -BH_GAP, 0.5) for s in (-1, 1)]
    lid = union([plate, lip, frame] + ribs)
    return diff(lid, [cyl(0, 0, -1, LID_T + 1, WINDOW_D)])

# ---------------------------------------------------------------- components (not printed; for checking the fit)
# Modelled from data sheets where no public 3D model exists (positions of small parts are approximate).
# The mic is Adafruit's own STEP (models/), imported and placed by import_step().
MODELS = os.path.join(HERE, "models")
MIC_STEP = os.path.join(MODELS, "adafruit-6049-i2s-mems-mic.step")  # same board size as the SPH0645 (3421)

def holes(b, pts, d, axis):
    """Drill small through-holes (solder holes, castellations) into board b."""
    cut = []
    for (x, y, z) in pts:
        if axis == "y":
            pl = G.Plane(G.Point3d(x, y - 5, z), G.Vector3d.YAxis)
        else:
            pl = G.Plane(G.Point3d(x, y, z - 5), G.Vector3d.ZAxis)
        cut.append(G.Cylinder(G.Circle(pl, d / 2), 10).ToBrep(True, True))
    return diff(b, cut, "holes")

def make_xiao():
    """Seeed XIAO ESP32C3 lying flat in its pocket, USB-C at the back edge (overhangs ~1 mm)."""
    z0, xb, x = DIV_TOP, IY - 1.5, XIAO_X
    zt = z0 + XIAO_T
    pcb = box(x - XIAO_W / 2, x + XIAO_W / 2, xb - XIAO_L, xb, z0, zt)
    pads = [(x + s * XIAO_W / 2, xb - 2.9 - i * 2.54, z0) for s in (-1, 1) for i in range(7)]  # castellations
    pcb = holes(pcb, pads, 1.0, "z")
    usb_c = USB_Z - XIAO_T
    return [
        ("XIAO PCB", pcb, (20, 20, 20)),
        ("XIAO USB-C", box(x - 4.47, x + 4.47, xb - 7.35 + 1.0, xb + 1.0, zt, zt + 2 * usb_c), (190, 190, 190)),
        ("XIAO ESP32-C3 chip", box(x - 2.5, x + 2.5, xb - 15.5, xb - 10.5, zt, zt + 0.85), (60, 60, 60)),
        ("XIAO U.FL antenna socket", box(x + XIAO_W / 2 - 4.0, x + XIAO_W / 2 - 1.4, xb - XIAO_L + 1.2, xb - XIAO_L + 3.8, zt, zt + 1.25), (210, 180, 90)),
        ("XIAO BOOT button", box(x - 7.6, x - 5.2, xb - 6.0, xb - 3.0, zt, zt + 1.0), (230, 230, 230)),
        ("XIAO RESET button", box(x + 5.2, x + 7.6, xb - 6.0, xb - 3.0, zt, zt + 1.0), (230, 230, 230)),
    ]

def make_scd41():
    """Pimoroni SCD41 breakout standing in the posts; sensor faces the front vents (-y)."""
    z0, t = FLOOR, SCD_T
    pcb = box(-SCD_W / 2, SCD_W / 2, -t / 2, t / 2, z0, z0 + SCD_H)
    pcb = holes(pcb, [(-5.08 + i * 2.54, 0, z0 + SCD_H - 1.6) for i in range(5)], 1.0, "y")   # 5-pin header row
    zc = z0 + SCD_H / 2 - 1.0
    return [
        ("SCD41 PCB", pcb, (20, 20, 20)),
        ("SCD41 sensor (Sensirion, 10.1 x 10.1 x 6.5)", box(-5.05, 5.05, -t / 2 - 6.5, -t / 2, zc - 5.05, zc + 5.05), (215, 215, 215)),
        ("SCD41 Qwiic connector (approx.)", box(-2.1, 2.1, t / 2, t / 2 + 2.9, z0 + 0.6, z0 + 3.6), (240, 240, 240)),
    ]

def make_bh1750(lid_z):
    """GY-302 (BH1750) on the lid's ribs, sensor chip under the window."""
    zt = lid_z - BH_GAP
    pcb = box(-BH_W / 2, BH_W / 2, -BH_D / 2, BH_D / 2, zt - 1.6, zt)
    pcb = holes(pcb, [(-BH_W / 2 + 2.5, 0, zt)], 3.0, "z")                                   # mounting hole
    pcb = holes(pcb, [(BH_W / 2 - 1.6, -5.08 + i * 2.54, zt) for i in range(5)], 1.0, "z")    # header row
    return [
        ("BH1750 PCB", pcb, (30, 60, 150)),
        ("BH1750 chip", box(-1.5, 1.5, -0.8, 0.8, zt, zt + 0.7), (40, 40, 40)),
        ("BH1750 regulator (approx.)", box(2.5, 5.4, 2.0, 3.6, zt, zt + 1.1), (40, 40, 40)),
    ]

def import_step(doc, path, lay):
    """Import a STEP file, move all its objects to a layer, return their ids."""
    before = set(o.Id for o in doc.Objects)
    if not os.path.exists(path) or not doc.Import(path):
        log("WARNING: could not import " + path)
        return []
    ids = [o.Id for o in doc.Objects if o.Id not in before]
    for i in ids:
        o = doc.Objects.FindId(i); o.Attributes.LayerIndex = lay; o.CommitChanges()
    return ids

def bbox_of(doc, ids):
    bb = G.BoundingBox.Empty
    for i in ids:
        bb.Union(doc.Objects.FindId(i).Geometry.GetBoundingBox(True))
    return bb

def place_mic(doc, ids):
    """Stand the imported mic board flat against the inside of the front wall, centred on the sound slot."""
    if not ids: return
    bb = bbox_of(doc, ids); d = bb.Diagonal
    log("mic STEP as imported: %d objects, %.1f x %.1f x %.1f mm" % (len(ids), d.X, d.Y, d.Z))
    xf = G.Transform.Identity
    if d.Z <= min(d.X, d.Y):                     # board lies in XY (usual): stand it up into XZ
        xf = G.Transform.Rotation(math.radians(90), G.Vector3d.XAxis, bb.Center)
    elif d.X <= min(d.Y, d.Z):                    # thinnest along X: turn about Z
        xf = G.Transform.Rotation(math.radians(90), G.Vector3d.ZAxis, bb.Center)
    for i in ids: doc.Objects.Transform(i, xf, True)
    bb = bbox_of(doc, ids)
    mv = G.Transform.Translation(MIC_X - bb.Center.X, -IY - bb.Min.Y, DIV_TOP - bb.Min.Z)
    for i in ids: doc.Objects.Transform(i, mv, True)
    d = bbox_of(doc, ids).Diagonal
    log("mic placed: %.1f x %.1f x %.1f mm (x, y, z)" % (d.X, d.Y, d.Z))

# ---------------------------------------------------------------- output
def write_stl(brep, path):
    mp = G.MeshingParameters.QualityRenderMesh
    mp.MinimumEdgeLength = 0.0001
    mesh = G.Mesh()
    for m in G.Mesh.CreateFromBrep(brep, mp):
        mesh.Append(m)
    mesh.Faces.ConvertQuadsToTriangles()
    mesh.Normals.ComputeNormals()
    mesh.FaceNormals.ComputeFaceNormals()
    v = mesh.Vertices
    with open(path, "wb") as f:
        f.write(b"bedroom-sensor case".ljust(80, b" "))
        f.write(struct.pack("<I", mesh.Faces.Count))
        for i in range(mesh.Faces.Count):
            fc, n = mesh.Faces[i], mesh.FaceNormals[i]
            f.write(struct.pack("<3f", n.X, n.Y, n.Z))
            for k in (fc.A, fc.B, fc.C):
                p = v[k]
                f.write(struct.pack("<3f", p.X, p.Y, p.Z))
            f.write(b"\0\0")
    return mesh.Faces.Count

def layer(doc, name, color):
    i = doc.Layers.FindByFullPath(name, -1)
    if i < 0:
        L = Rhino.DocObjects.Layer(); L.Name = name; L.Color = color
        i = doc.Layers.Add(L)
    return i

def add(doc, geo, lay, name):
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = lay; a.Name = name
    return doc.Objects.AddBrep(geo, a)

def moved(b, x=0, y=0, z=0):
    b = b.DuplicateBrep(); b.Translate(G.Vector3d(x, y, z)); return b

def main():
    open(LOG, "w").close()
    doc = sc.doc
    doc.ModelUnitSystem = Rhino.UnitSystem.Millimeters
    shell, divider, lid = make_shell(), make_divider(), make_lid()
    for n, b in (("shell", shell), ("divider", divider), ("lid", lid)):
        log("%-8s solid=%s volume=%.1f mm3" % (n, b.IsSolid, G.VolumeMassProperties.Compute(b).Volume))

    # STLs in print orientation: shell upright, divider flat, lid upside down (plate on the bed)
    os.makedirs(os.path.join(HERE, "stl"), exist_ok=True)
    lid_print = lid.DuplicateBrep(); lid_print.Rotate(math.pi, G.Vector3d.XAxis, G.Point3d.Origin); lid_print.Translate(0, 0, LID_T)
    for n, b in (("shell", shell), ("divider", divider), ("lid", lid_print)):
        log("%-8s %d triangles" % (n, write_stl(b, os.path.join(HERE, "stl", n + ".stl"))))

    # 3dm: parts assembled (lid and divider in place) plus an exploded copy with dummy boards
    lp = layer(doc, "Print parts", SD.Color.FromArgb(200, 200, 200))
    add(doc, shell, lp, "shell")
    add(doc, moved(divider, z=DIV_Z), lp, "divider")
    lid_z = SHELL_H + 18
    add(doc, moved(lid, z=lid_z), lp, "lid (lifted)")
    # components: one sub-layer per board, colours per part
    root = layer(doc, "Components (not printed)", SD.Color.FromArgb(40, 140, 90))
    def sub(name):
        L = Rhino.DocObjects.Layer(); L.Name = name; L.ParentLayerId = doc.Layers[root].Id
        L.Color = SD.Color.FromArgb(40, 140, 90)
        return doc.Layers.Add(L)
    for lname, parts in (("XIAO ESP32C3", make_xiao()), ("SCD41 (Pimoroni)", make_scd41()), ("BH1750 (GY-302)", make_bh1750(lid_z))):
        li = sub(lname)
        for n, b, rgb in parts:
            a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = li; a.Name = n
            a.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromObject; a.ObjectColor = SD.Color.FromArgb(*rgb)
            doc.Objects.AddBrep(b, a)
    place_mic(doc, import_step(doc, MIC_STEP, sub("I2S microphone (Adafruit STEP)")))
    doc.Views.Redraw()

    try:
        view = doc.Views.ActiveView
        view.ActiveViewport.SetProjection(Rhino.Display.DefinedViewportProjection.Perspective, "Perspective", False)
        mode = Rhino.Display.DisplayModeDescription.FindByName("Shaded")
        if mode: view.ActiveViewport.DisplayMode = mode
        cam = view.ActiveViewport
        cam.SetCameraLocations(G.Point3d(0, 0, 45), G.Point3d(-140, -170, 150))
        cam.ZoomExtents()
        view.Redraw()
        view.CaptureToBitmap(SD.Size(1200, 900)).Save(os.path.join(HERE, "preview.png"))
        # back view for the USB opening and the upper vents
        cam.SetCameraLocations(G.Point3d(0, 0, 45), G.Point3d(140, 170, 120))
        cam.ZoomExtents(); view.Redraw()
        view.CaptureToBitmap(SD.Size(1200, 900)).Save(os.path.join(HERE, "preview-back.png"))
        # cut-away (left half removed) to check the inside; temporary objects, deleted afterwards
        tmp = [add(doc, diff(shell.DuplicateBrep(), [box(-OX - 1, 0.0, -OY - 1, OY + 1, -1, SHELL_H + 1)], "cutaway"), lp, "tmp"),
               add(doc, diff(moved(divider, z=DIV_Z), [box(-OX - 1, -IX + 6, -OY - 1, OY + 1, 0, 50)], "cutaway"), lp, "tmp")]
        for o in doc.Objects.FindByLayer(doc.Layers[lp]):
            if o.Attributes.Name != "tmp": doc.Objects.Hide(o.Id, True)
        cam.SetCameraLocations(G.Point3d(0, 0, 40), G.Point3d(-190, -60, 110))
        cam.ZoomExtents(); view.Redraw()
        view.CaptureToBitmap(SD.Size(1200, 900)).Save(os.path.join(HERE, "preview-inside.png"))
        for t in tmp: doc.Objects.Delete(t, True)
        settings = Rhino.DocObjects.ObjectEnumeratorSettings(); settings.HiddenObjects = True
        for o in doc.Objects.GetObjectList(settings):
            if o.IsHidden: doc.Objects.Show(o.Id, True)
        cam.SetCameraLocations(G.Point3d(0, 0, 45), G.Point3d(-140, -170, 150))
        cam.ZoomExtents(); view.Redraw()
    except Exception:
        log("preview failed:\n" + traceback.format_exc())

    doc.WriteFile(os.path.join(HERE, "case.3dm"), Rhino.FileIO.FileWriteOptions())
    doc.Modified = False
    log("done")

try:
    main()
except Exception:
    log("ERROR:\n" + traceback.format_exc())
finally:
    sc.doc.Modified = False   # lets "_-Exit" close Rhino without a save prompt

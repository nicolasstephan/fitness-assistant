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
XIAO_W, XIAO_L, XIAO_X = 17.5, 21.0, -8.0  # XIAO ESP32C3 lying flat, USB-C to the back wall
USB_W, USB_H, USB_Z = 13.0, 8.0, 2.6       # opening for the USB-C plug (Z above the divider top)
MIC_W, MIC_H, MIC_X = 16.5, 12.7, 9.0      # Adafruit SPH0645, flat against the front wall
MIC_HOLE_W, MIC_HOLE_H = 2.5, 6.0          # sound slot through the front wall at the board's centre
BH_W, BH_D = 18.5, 13.9                    # GY-302 (BH1750) under the lid
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
    frame = diff(box(-bw - 1.2, bw + 1.2, -bd - 1.2, bd + 1.2, -2.0, 0.01),
                 [box(-bw, bw, -bd, bd, -3, 0.5)])
    lid = union([plate, lip, frame])
    return diff(lid, [cyl(0, 0, -1, LID_T + 1, WINDOW_D)])

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
    ld = layer(doc, "Dummy boards (not printed)", SD.Color.FromArgb(40, 140, 90))
    add(doc, shell, lp, "shell")
    add(doc, moved(divider, z=DIV_Z), lp, "divider")
    add(doc, moved(lid, z=SHELL_H + 18), lp, "lid (lifted)")
    xb = IY - 1.5
    dummies = [
        ("SCD41", box(-SCD_W / 2, SCD_W / 2, -SCD_T / 2, SCD_T / 2, FLOOR, FLOOR + SCD_H)),
        ("SCD41 sensor", box(-5, 5, -SCD_T / 2 - 6.5, -SCD_T / 2, FLOOR + 5, FLOOR + 15)),
        ("XIAO ESP32C3", box(XIAO_X - XIAO_W / 2, XIAO_X + XIAO_W / 2, xb - XIAO_L, xb, DIV_TOP, DIV_TOP + 1.0)),
        ("USB-C", box(XIAO_X - 4.5, XIAO_X + 4.5, xb - 7, xb + 1, DIV_TOP + 1.0, DIV_TOP + 4.2)),
        ("SPH0645 mic", box(MIC_X - MIC_W / 2, MIC_X + MIC_W / 2, -IY, -IY + SCD_T, DIV_TOP, DIV_TOP + MIC_H)),
        ("BH1750", box(-BH_W / 2, BH_W / 2, -BH_D / 2, BH_D / 2, SHELL_H + 18 - 1.6, SHELL_H + 18)),
    ]
    for n, b in dummies:
        add(doc, b, ld, n)
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

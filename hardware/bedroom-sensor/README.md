# Bedroom sensor: case

A small tower (44 × 36 × 80 mm) for a bedroom sensor that logs CO₂, temperature, humidity, noise level and light
every minute, to compare with Polar sleep data in the Health view.

| File | What |
|---|---|
| `case.py` | Rhino 8 script (CPython), all sizes as variables at the top. Run: ScriptEditor → Run, or `_-RunPythonScript case.py` |
| `case.3dm` | Result: print parts, the lid lifted, dummy boards on their own layer |
| `stl/shell.stl`, `stl/divider.stl`, `stl/lid.stl` | Print files, already in print orientation, mm |
| `preview*.png` | Front, back and cut-away renders |

## Parts (BerryBase, 2026-11-05)
- Seeed XIAO ESP32C3 (SE-113991054), €7.90, **without header**: wires are soldered on, so it lies flat
- Pimoroni SCD41 breakout (PIM587), €49.90: CO₂, temperature, humidity
- Adafruit SPH0645 I2S microphone, €8.90: sound **level** only, no audio is stored or sent
- GY-302 BH1750 light sensor, €2.40
- thin silicone wire, USB-C charger + cable

## Layout
- **Lower chamber:** the SCD41 stands in two grooved posts, sensor facing the front, with vents on all four sides and in
  the floor. The divider plate keeps the ESP32's heat out of this chamber (otherwise the temperature reads 1–2 °C high).
- **Divider plate:** sits on a ledge, has a pocket for the XIAO (USB-C to the back opening) and a notch for the sensor
  wires on the right.
- **Upper chamber:** the mic sits flat against the front wall between two L-rails, with its sound hole on the slot.
  Heat escapes through the slots near the top. Stick the antenna to a side wall.
- **Lid:** friction lip, with the BH1750 in a pocket under the light window (a dab of hot glue).

## Before printing: measure and adjust (`case.py` parameters)
- `SCD_W/SCD_H`: the Pimoroni board size, and which edge has the header holes (the posts hold the left and right edges)
- `MIC_W/MIC_H`, `MIC_HOLE_*`: the mic board and where its sound port is (the SPH0645 port is on the board's top
  side, which faces the wall)
- `USB_Z`: height of the USB-C centre above the plate, measured on the soldered XIAO
- `BH_W/BH_D`, `WINDOW_D`: position of the BH1750 chip under the window
- `FIT` (0.3 mm): increase it if parts are too tight on your printer

Print: PLA or PETG, 0.2 mm layers, no supports (the slots are 2 mm tall and bridge fine). Print the lid plate-down.
Use white or light filament: dark plastic in a sunny spot heats up and skews the temperature.

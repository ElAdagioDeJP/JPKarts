"""Contact sheet of the kart parts: python -I art/blender/sheet.py  (needs Pillow; reads art/blender/renders/part_*.png).
Rows: 4 chassis x (front 3/4, back 3/4, side, top); 4 wheels x (3/4, side); 3 wings x (front 3/4, top). Writes renders/parts_sheet.png."""
import os
from PIL import Image, ImageDraw

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'renders')
C = 420
NAMES = dict(kernel='Kernel', overdrive='Overdrive', mainframe='Mainframe', rover='Rover', std='Rueda Estandar', slick='Slick',
             offroad='Todoterreno', mini='Mini', wing='Ala Estandar', glider='Ala Planeadora', light='Ala Ligera')
blocks = [
    ('KARTS (con JP y ruedas estandar)', ['kernel', 'overdrive', 'mainframe', 'rover'], ['f34', 'b34', 'side', 'top']),
    ('RUEDAS', ['std', 'slick', 'offroad', 'mini'], ['f34', 'side']),
    ('ALAS', ['wing', 'glider', 'light'], ['f34', 'b34', 'top']),
]
rows = sum(len(v) for _, _, v in blocks)
sheet = Image.new('RGB', (C * 4, C * rows + 40 * len(blocks)), (36, 38, 44))
dr = ImageDraw.Draw(sheet)
y = 0
for title, ids, views in blocks:
    dr.text((12, y + 12), title, fill=(255, 220, 120))
    y += 40
    for v in views:
        for i, pid in enumerate(ids):
            f = os.path.join(D, ('kart_' if pid in ('kernel', 'overdrive', 'mainframe', 'rover') else 'part_') + f'{pid}_{v}.png')
            if os.path.exists(f):
                sheet.paste(Image.open(f).convert('RGB').resize((C, C), Image.LANCZOS), (i * C, y))
            if v == views[0]:
                dr.text((i * C + 10, y + 8), NAMES[pid], fill=(255, 255, 255))
        y += C
sheet.save(os.path.join(D, 'parts_sheet.png'))
print(sheet.size)

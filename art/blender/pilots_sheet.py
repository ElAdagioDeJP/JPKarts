"""Contact sheet of the 12 pilots (front, 3/4, back each): python -I art/blender/pilots_sheet.py -> renders/pilots_sheet.png"""
import os
from PIL import Image, ImageDraw
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'renders')
IDS = ['marco', 'guaycaipuro', 'luis', 'jesus', 'miguel', 'jp', 'mario', 'andres', 'edu', 'diego', 'angel', 'henry']
NAMES = dict(marco='Marco', guaycaipuro='Guaycaipuro', luis='Luis', jesus='Jesus', miguel='Miguel', jp='JP', mario='Mario', andres='Andres', edu='Edu (Eduardo)', diego='Dieguito (Diego)', angel='Angelito (Angel)', henry='Henry')
C, COLS = 320, 3
rows = (len(IDS) + COLS - 1) // COLS
sheet = Image.new('RGB', (C * 3 * COLS, C * rows), (36, 38, 44))
dr = ImageDraw.Draw(sheet)
for i, pid in enumerate(IDS):
    x0, y0 = (i % COLS) * C * 3, (i // COLS) * C
    for j, v in enumerate(('front', '34', 'back')):
        f = os.path.join(D, f'{pid}_{v}.png')
        if os.path.exists(f):
            sheet.paste(Image.open(f).convert('RGB').resize((C, C), Image.LANCZOS), (x0 + j * C, y0))
    dr.text((x0 + 10, y0 + 8), NAMES[pid], fill=(255, 230, 120))
sheet.save(os.path.join(D, 'pilots_sheet.png'))
print(sheet.size)

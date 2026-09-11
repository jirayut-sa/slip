from PIL import Image
from pathlib import Path
root=Path(__file__).parent/'assets'
for i in range(1,25):
 for rarity in ['regular','secret']:
  for mood in ['happy','waiting','angry']:
   key=f'c{i:02}-{rarity}-{mood}'
   frames=[Image.open(root/'frames'/f'{key}-{f}.png').convert('RGBA') for f in range(6)]
   dest=root/f'{key}.png';tmp=root/f'{key}.new.png'
   frames[0].save(tmp,save_all=True,append_images=frames[1:],duration=180,loop=0,disposal=0,blend=0)
   with Image.open(tmp) as im:
    assert im.n_frames>=2
    im.seek(im.n_frames-1);im.load()
   assert tmp.stat().st_size<=300000
   tmp.replace(dest)
print('Validated 144 animated PNG files, each <=300 KB')

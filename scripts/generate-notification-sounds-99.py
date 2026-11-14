"""Original short PCM cues shared by in-app, APNs, Android channels and web previews."""
from pathlib import Path
import math,wave,struct
ROOT=Path(__file__).resolve().parents[2]
notes={'merchant_bell':[(784,.19),(1046.5,.3),(784,.19),(1046.5,.38)],'driver_offer':[(659.25,.18),(880,.18),(987.77,.30)],'online_chime':[(523.25,.16),(659.25,.16),(783.99,.34)],'soft_chime':[(698.46,.22),(880,.38)]}
for name,sequence in notes.items():
 samples=[]
 for hz,duration in sequence:
  count=int(duration*22050)
  for i in range(count):
   t=i/22050;env=min(1,t/.015)*min(1,(duration-t)/.09)*math.exp(-1.7*t)
   value=(math.sin(2*math.pi*hz*t)+.16*math.sin(2*math.pi*2*hz*t))*.35*env
   samples.append(int(value*32767))
  samples.extend([0]*int(.035*22050))
 destinations=[ROOT/'whizzCentralPlatform-stg/frontend/assets/sounds'/f'{name}.wav']
 for repo in ['whizzMerchants-stg','whizzDrivers-stg']:
  destinations += [ROOT/repo/'frontend/assets/sounds'/f'{name}.wav',ROOT/repo/'frontend/ios/Runner/NotificationSounds'/f'{name}.wav',ROOT/repo/'frontend/android/app/src/main/res/raw'/f'{name}.wav']
 for p in destinations:
  p.parent.mkdir(exist_ok=True,parents=True)
  with wave.open(str(p),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(22050);w.writeframes(struct.pack('<'+'h'*len(samples),*samples))
print('Generated four original cues for both apps and platform previews.')

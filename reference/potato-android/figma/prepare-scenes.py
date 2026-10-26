import json,re
from pathlib import Path
b=Path(__file__).parent
allsc=json.loads((b/'scenes.json').read_text())['scenes']
state=json.loads((b/'foundations-result.json').read_text())
state={k:state[k] for k in ['pages','variables','styles','icons','mascots','buttonComps']}

def clean(d):
 out={k:d[k] for k in ['type','x','y','w','h']}
 out['name']=d.get('name','')[:60]
 for k in ['bg','bc','bw','radius','opacity','edges','position','overflow','scrollHeight','go']:
  if k in d:out[k]=d[k]
 if 'btn' in d.get('cls','').split():out['cls']=d['cls']
 if d['type']=='text':
  for k in ['text','fontSize','fontWeight','lineHeight','textAlign','color','letterSpacing']:
   if k in d:out[k]=d[k]
 elif d['type']=='mascot':out['pose']=d['pose']
 elif d['type']=='svg':
  s=d['svg']
  s=re.sub(r'\s(?:class|style|color|data-icon|aria-hidden|role)="[^"]*"','',s)
  s=re.sub(r'\s(?:opacity|fill-opacity|stroke-opacity|stop-opacity)="1"','',s)
  s=re.sub(r'\s(?:stroke-dasharray)="none"','',s)
  s=re.sub(r'\sxmlns="[^"]*"','',s)
  s=re.sub(r'\s(?:stroke-dashoffset)="0px"','',s)
  out['svg']=s
  if 'icon' in d:out['icon']=d['icon']
 lay=d.get('layout',{})
 if 'grid' in lay.get('display',''):out['layout']={k:lay[k] for k in ['display','padding','rowGap','columnGap'] if k in lay}
 if d.get('children'):out['children']=[clean(c) for c in d['children']]
 for k in ['bg','bc','color']:
  if k in out:
   out[k]=[round(n,4) for n in out[k]]
 return out
scenes=[]
for s in allsc:
 scenes.append({**{k:s[k] for k in ['id','title','group','canvasX','canvasY','number']},'root':clean(s['root'])})
(b/'compact-scenes.json').write_text(json.dumps(scenes,ensure_ascii=False,separators=(',',':')))
(b/'minimal-state.json').write_text(json.dumps(state,ensure_ascii=False,separators=(',',':')))
factory=(b/'build-scenes.js').read_text()
header='const STATE='+json.dumps(state,ensure_ascii=False,separators=(',',':'))+';\n'
groups=[];group=[]
for s in scenes:
 candidate=group+[s]
 code=header+'const SCENES='+json.dumps(candidate,ensure_ascii=False,separators=(',',':'))+';\n'+factory
 if len(code)>49900 and group:
  groups.append(group);group=[s]
 else:group=candidate
 if len(header+'const SCENES='+json.dumps(group,ensure_ascii=False,separators=(',',':'))+';\n'+factory)>49900:raise Exception('Scene still too big '+s['id'])
if group:groups.append(group)
for i,g in enumerate(groups):
 code=header+'const SCENES='+json.dumps(g,ensure_ascii=False,separators=(',',':'))+';\n'+factory
 (b/f'build-batch-{i:02d}.js').write_text(code)
 print(i,len(code),','.join(s['id'] for s in g))
# Small initial sample for visual verification.
(b/'build-sample.js').write_text(header+'const SCENES='+json.dumps(scenes[:1],ensure_ascii=False,separators=(',',':'))+';\n'+factory)
print('batch_count',len(groups))

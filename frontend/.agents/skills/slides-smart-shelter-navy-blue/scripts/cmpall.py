import sys, json
from pptx import Presentation
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
def texts(sl):
    out=[]
    def walk(shapes):
        for sh in shapes:
            if sh.shape_type==6: walk(sh.shapes)
            elif sh.has_text_frame and not sh.name.startswith('Nav '):
                out.extend(''.join(t.text or '' for t in p._p.iter(A+'t')) for p in sh.text_frame.paragraphs)
    walk(sl.shapes); return [t.strip() for t in out if t.strip()]
src, new, cfgp = sys.argv[1:4]
cfg=json.load(open(cfgp))
o=Presentation(src); n=Presentation(new)
drop=set(cfg.get('delete_slides',[]))
osl=[s for i,s in enumerate(o.slides, start=1) if i!=1 and i not in drop]
nsl=list(n.slides)[1:]
print('slides', len(o.slides), '->', len(n.slides))
bad=0
for k,(a,b) in enumerate(zip(osl,nsl)):
    ta=sorted(texts(a)); tb=sorted(texts(b))
    # new: page number field, 'ordering' tolerances: footer/page strips in d5, joined titles
    tb2=[t for t in tb if t!='‹#›' and not (t.isdigit() and t not in ta)]
    ja=sorted(' '.join(ta)), sorted(' '.join(tb2))
    na=''.join(''.join(ta).split()); nb=''.join(''.join(tb2).split())
    if sorted(na)!=sorted(nb):
        bad+=1
        extra=[x for x in tb2 if x not in ta]; missing=[x for x in ta if x not in tb2]
        print(' slide', k+2, 'missing:', missing[:3], 'extra:', extra[:3])
print('slides with text differences:', bad)

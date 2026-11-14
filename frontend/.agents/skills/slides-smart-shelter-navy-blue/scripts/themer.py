"""Restyle a SmartShelter manual deck into the shared navy / Prompt theme."""
import copy, json, os, sys
from pptx import Presentation
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Emu
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from lxml import etree

NS = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
      'p':'http://schemas.openxmlformats.org/presentationml/2006/main',
      'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
A = '{%s}' % NS['a']; P = '{%s}' % NS['p']
E = 914400
def emu(i): return int(round(i*E))

NAVY, CERU, BG, MUTED, LINE = '0A2647', '0284C7', 'F8FAFC', '64748B', 'E2E8F0'
TINT, TINT2 = 'E4F0FF', 'BFD4F2'
FONT = 'Prompt'
LOGO = os.environ.get('SS_LOGO') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'logo.png')
NSD = f'xmlns:p="{NS["p"]}" xmlns:a="{NS["a"]}"'

# frames (inches): left, top, width, height of the content area per layout
FRAME = {'band': (0.9, 1.9, 18.2, 8.4), 'compact': (0.9, 1.5, 18.2, 8.85)}

LIGHT = {'FFFFFF':'0A2647','CBD5E1':'334155','BFD4F2':'0284C7','F8FAFC':'0A2647','E2E8F0':'334155','FDFDFC':'0A2647'}
COLOR = {'0F766E':NAVY,'1E3A5F':NAVY,'CCFBF1':TINT,'00796B':NAVY,'E7F4F2':TINT,'083F3B':NAVY,
         '0E2A47':NAVY,'0B2545':NAVY,'13315C':NAVY,'0D9488':CERU,'2563EB':CERU,'1565C0':CERU,'2E7D5B':'124481',
         '7B4FA0':'5B7DB1','7C3AED':'5B7DB1','DB2777':'5B7DB1','D35400':'124481','EA580C':'124481',
         '5EEAD4':TINT2,'7FC7C1':TINT2,'D8F3F0':TINT,'F0FDFA':TINT,'F5F3FF':'F1F5F9','FCE3D6':TINT,'F4F6FA':BG}
LINECOLOR = {'0F766E':CERU,'2563EB':CERU,'7C3AED':'5B7DB1'}
BOLD_HINT = ('Bold','Semi','Santiphap')

# ---------- XML helpers
def rect(i, name, x, y, w, h, fill, geom='rect'):
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="{name}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>'
            f'<a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>'
            f'<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>')
def defrpr(color, sz, bold):
    return (f'<a:defRPr sz="{sz}" b="{int(bold)}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:latin typeface="{FONT}"/><a:ea typeface="{FONT}"/><a:cs typeface="{FONT}"/></a:defRPr>')
def ph(i, name, typ, idx, x, y, w, h, algn, anchor, rpr, text, size_attr=True):
    idxa = f' idx="{idx}"' if idx else ''
    sz = ' sz="quarter"' if typ not in ('title','ctrTitle') and size_attr else ''
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            f'<p:nvPr><p:ph type="{typ}"{sz}{idxa}/></p:nvPr></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm></p:spPr>'
            f'<p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="{anchor}"><a:normAutofit/></a:bodyPr>'
            f'<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="{algn}"><a:buNone/>{rpr}</a:lvl1pPr></a:lstStyle>'
            f'<a:p>{text}</a:p></p:txBody></p:sp>')
def label(t): return f'<a:r><a:rPr lang="th-TH"/><a:t>{t}</a:t></a:r>'
SLDNUM_FLD = '<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="th-TH"/><a:t>‹#›</a:t></a:fld>'
def cslide(name, bg, shapes, typ):
    return (f'<p:cSld xmlns:p="{NS["p"]}" xmlns:a="{NS["a"]}" name="{name}">'
            f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
            '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            + shapes + '</p:spTree></p:cSld>')

def sldnum(color): return ph(4, 'Slide number', 'sldNum', 12, 17.1, 10.58, 2.0, 0.4, 'r', 'ctr', defrpr(color, 1400, False), SLDNUM_FLD)

LAYOUTS = {
 'cover': ('Cover', NAVY, 'title',
   rect(10, 'Accent bar', 1.2, 3.5, 1.6, 0.08, CERU)
   + ph(2, 'Title', 'ctrTitle', 0, 1.2, 3.85, 16.4, 3.2, 'l', 't', defrpr('FFFFFF', 7200, True), label('Title'))
   + ph(3, 'Subtitle', 'subTitle', 1, 1.2, 7.2, 16.4, 0.8, 'l', 't', defrpr(TINT2, 3600, True), label('Subtitle'))
   + ph(5, 'Description', 'body', 13, 1.2, 8.15, 16.4, 1.5, 'l', 't', defrpr(TINT, 2400, False), label('Description'))
   + ph(6, 'Edition', 'body', 14, 1.2, 10.0, 12.0, 0.5, 'l', 'ctr', defrpr(TINT2, 2000, False), label('Edition'))
   + sldnum(TINT2)),
 'band': ('Content – Band', BG, 'titleOnly',
   rect(10, 'Header band', 0, 0, 20, 1.3, NAVY) + rect(11, 'Accent bar', 0.9, 1.1, 1.2, 0.06, CERU)
   + rect(12, 'Footer rule', 0.9, 10.45, 18.2, 0.012, LINE)
   + ph(2, 'Title', 'title', 0, 0.9, 0.12, 18.2, 0.95, 'l', 'ctr', defrpr('FFFFFF', 4000, True), label('Title'))
   + sldnum(MUTED)),
 'compact': ('Content – Compact', BG, 'titleOnly',
   rect(10, 'Top strip', 0, 0, 20, 0.2, NAVY) + rect(11, 'Accent bar', 0.9, 1.18, 1.2, 0.06, CERU)
   + rect(12, 'Footer rule', 0.9, 10.45, 18.2, 0.012, LINE)
   + ph(2, 'Title', 'title', 0, 0.9, 0.32, 18.2, 0.8, 'l', 'ctr', defrpr(NAVY, 4000, True), label('Title'))
   + sldnum(MUTED)),
}
LAYOUT_SRC = {'cover': 0, 'band': 5, 'compact': 6}   # stock layout indexes that get rewritten

def setup_theme_and_layouts(prs):
    master = prs.slide_master
    theme_part = [r.target_part for r in master.part.rels.values() if r.reltype.endswith('/theme')][0]
    th = etree.fromstring(theme_part.blob)
    clr = th.find('.//a:clrScheme', NS)
    for tag, val in dict(dk2=NAVY, lt2=BG, accent1=NAVY, accent2=CERU, accent3='124481', accent4=MUTED,
                         accent5=TINT2, accent6='B45309', hlink=CERU, folHlink='124481').items():
        el = clr.find('a:'+tag, NS)
        for c in list(el): el.remove(c)
        etree.SubElement(el, A+'srgbClr').set('val', val)
    clr.set('name', 'SmartShelter Navy')
    for which in ('majorFont', 'minorFont'):
        f = th.find('.//a:'+which, NS)
        for c in list(f): f.remove(c)
        for t in ('latin','ea','cs'): etree.SubElement(f, A+t).set('typeface', FONT)
        etree.SubElement(f, A+'font', script='Thai', typeface=FONT)
    th.find('.//a:fontScheme', NS).set('name', 'SmartShelter Prompt')
    theme_part._blob = etree.tostring(th, xml_declaration=True, encoding='UTF-8', standalone=True)
    mcs = master._element.find('p:cSld', NS)
    old = mcs.find('p:bg', NS)
    if old is not None: mcs.remove(old)
    mcs.insert(0, etree.fromstring(f'<p:bg {NSD}><p:bgPr><a:solidFill><a:srgbClr val="{BG}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'))
    stock = list(prs.slide_layouts)
    out = {}
    for key, i in LAYOUT_SRC.items():
        name, bg, typ, shapes = LAYOUTS[key]
        l = stock[i]; root = l._element
        root.replace(root.find('p:cSld', NS), etree.fromstring(cslide(name, bg, shapes, typ)))
        root.set('type', typ)
        out[key] = l
    lst = master._element.find('p:sldLayoutIdLst', NS)
    for lid, l in zip(list(lst), stock):
        if l not in out.values():
            master.part.drop_rel(lid.get('{%s}id' % NS['r'])); lst.remove(lid)
    return out

def size_map(sz):
    pt = sz/100
    if pt >= 39: return 4000
    if pt >= 26: return 2800
    if pt >= 20: return 2400
    return 1800

def restyle(root, recolor_light=False, keep_sizes=False):
    if not keep_sizes:
        # notes / warnings (amber, red, orange text) are captions whatever size the old deck gave them
        for rpr in root.iter(A+'rPr'):
            c = rpr.find('a:solidFill/a:srgbClr', NS)
            if c is not None and c.get('val') in ('B45309','B91C1C','C2410C') and rpr.get('sz') and int(rpr.get('sz')) < 2600:
                rpr.set('sz', '1800')
        for p in root.iter(A+'p'):
            sp = p.find('a:pPr/a:lnSpc/a:spcPts', NS)
            r = p.find('a:r/a:rPr', NS)
            ratio = None
            if sp is not None and r is not None and r.get('sz'):
                ratio = int(sp.get('val'))/int(r.get('sz'))
            for rpr in list(p.iter(A+'rPr', A+'endParaRPr')):
                if rpr.get('sz'): rpr.set('sz', str(size_map(int(rpr.get('sz')))))
            if ratio is not None:
                sp.set('val', str(int(round(ratio*int(p.find('a:r/a:rPr', NS).get('sz'))))))
    for rpr in root.iter(A+'rPr', A+'endParaRPr', A+'defRPr'):
        lat = rpr.find('a:latin', NS)
        old_face = lat.get('typeface') if lat is not None else ''
        if any(h in old_face for h in BOLD_HINT): rpr.set('b', '1')
        for t in ('latin','ea','cs','sym'):
            e = rpr.find('a:'+t, NS)
            if e is not None:
                if t == 'sym': rpr.remove(e)
                else:
                    e.set('typeface', FONT)
                    for at in ('panose','pitchFamily','charset'): e.attrib.pop(at, None)
        c = rpr.find('a:solidFill/a:srgbClr', NS)
        if c is not None and c.get('val') in COLOR: c.set('val', COLOR[c.get('val')])
        if recolor_light and c is not None and c.get('val') in LIGHT: c.set('val', LIGHT[c.get('val')])
    for ln in root.iter(A+'ln'):
        c = ln.find('a:solidFill/a:srgbClr', NS)
        if c is not None and c.get('val') in LINECOLOR: c.set('val', LINECOLOR[c.get('val')])
    for sp in root.iter(P+'spPr'):
        c = sp.find('a:solidFill/a:srgbClr', NS)
        if c is not None and c.get('val') in COLOR: c.set('val', COLOR[c.get('val')])

def maxsz(sh):
    return max([int(r.get('sz')) for r in sh._element.iter(A+'rPr') if r.get('sz')] or [0])

def para_texts(sh):
    return [''.join(t.text or '' for t in p.iter(A+'t')) for p in sh._element.iter(A+'p')]

def restyle_slide(prs, slide, layouts, notitle=False, log=None):
    tree = slide.shapes._spTree
    shapes = list(slide.shapes)
    SW, SH = prs.slide_width, prs.slide_height
    def is_deco(s):
        return (s.height >= SH*0.95 and s.width < emu(1.5)) or (s.width >= SW*0.95 and s.height < emu(0.5))
    deco = [s for s in shapes if is_deco(s) and not (s.has_text_frame and s.text_frame.text.strip())]
    texts = [s for s in shapes if s.has_text_frame and s.text_frame.text.strip() and s not in deco]
    title_sh = None if notitle or not texts else max(texts, key=maxsz)
    if title_sh is not None and maxsz(title_sh) < 3600: title_sh = None
    content = [s for s in shapes if s is not title_sh and s not in deco]
    title_paras = [para_texts(title_sh)] if title_sh is not None else []
    for s in content:
        # a tall multi-paragraph column set small by the old deck is body text, not a caption
        if s.has_text_frame and s.width >= emu(6.0) and len(s.text_frame.paragraphs) >= 3:
            szs = [int(r.get('sz')) for r in s._element.iter(A+'rPr') if r.get('sz')]
            if szs and all(1700 <= z <= 1900 for z in szs):
                for r in s._element.iter(A+'rPr', A+'endParaRPr'):
                    if r.get('sz'): r.set('sz', '2200')
        restyle(s._element)
    # choose layout: band by default, compact when the band would force a clearly stronger shrink
    l = min(s.left for s in content); t = min(s.top for s in content)
    r_ = max(s.left+s.width for s in content); b = max(s.top+s.height for s in content)
    bw, bh = (r_-l)/E, (b-t)/E
    def sc(k): fx, fy, fw, fh = FRAME[k]; return min(1, fw/bw, fh/bh)
    kind = 'compact' if sc('band') < 0.85*sc('compact') else 'band'
    fx, fy, fw, fh = FRAME[kind]; scale = sc(kind)
    for s in content:
        s.left = emu(fx) + int((s.left-l)*scale); s.top = emu(fy) + int((s.top-t)*scale)
        if scale < 1: s.width = int(s.width*scale); s.height = int(s.height*scale)
    if title_sh is not None: tree.remove(title_sh._element)
    for d in deco: tree.remove(d._element)
    for rel in slide.part.rels.values():
        if rel.reltype == RT.SLIDE_LAYOUT: rel._target = layouts[kind].part
    if title_sh is not None:
        paras = ''.join('<a:p>' + ''.join(f'<a:r><a:rPr lang="th-TH"/><a:t>{x}</a:t></a:r>' for x in [pt]) + '</a:p>' for pt in title_paras[0])
        tree.find('p:grpSpPr', NS).addnext(etree.fromstring(
            f'<p:sp {NSD}><p:nvSpPr><p:cNvPr id="900" name="Title 900"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp>'))
    tree.append(etree.fromstring(
        f'<p:sp {NSD}><p:nvSpPr><p:cNvPr id="901" name="Slide Number Placeholder 901"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>{SLDNUM_FLD}</a:p></p:txBody></p:sp>'))
    if log is not None: log.append((kind, round(bw,2), round(bh,2), round(scale,3), title_sh is not None, len(deco)))

def make_cover(prs, layouts, title_lines, subtitle, desc_lines, edition):
    slide = prs.slides.add_slide(layouts['cover'])
    ph_by = {p.placeholder_format.idx: p for p in slide.placeholders}
    def fill(p, lines):
        tf = p.text_frame; tf.text = lines[0]
        for x in lines[1:]: tf.add_paragraph().text = x
    fill(ph_by[0], title_lines); fill(ph_by[1], [subtitle])
    fill(ph_by[13], desc_lines); fill(ph_by[14], [edition])
    slide.shapes._spTree.append(etree.fromstring(
        f'<p:sp {NSD}><p:nvSpPr><p:cNvPr id="901" name="Slide Number Placeholder 901"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>{SLDNUM_FLD}</a:p></p:txBody></p:sp>'))
    badge = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(1.2), emu(1.0), emu(1.5), emu(1.5))
    badge.fill.solid(); badge.fill.fore_color.rgb = RGBColor(0xFF,0xFF,0xFF); badge.line.fill.background()
    badge.adjustments[0] = 0.18; badge.name = 'Logo badge'
    pic = slide.shapes.add_picture(LOGO, emu(1.4), emu(1.2), emu(1.1), emu(1.1)); pic.name = 'SmartShelter logo'
    pic._element.nvPicPr.cNvPr.set('descr', 'PSU Smart Shelter logo')
    return slide

def build(src, out, cfg):
    prs = Presentation(src)
    COLOR.update(cfg.get('color_map', {}))
    if 'light_map' in cfg: LIGHT.clear(); LIGHT.update(cfg['light_map'])
    layouts = setup_theme_and_layouts(prs)
    ids = prs.slides._sldIdLst
    orig = list(ids)
    log = []
    drop = set(cfg.get('delete_slides', []))
    for i, sid in enumerate(orig, start=1):
        slide = prs.slides[list(ids).index(sid)]
        if i == 1 or i in drop: continue
        restyle_slide(prs, slide, layouts, notitle=(i in cfg.get('notitle', [])), log=log, cfg=cfg, idx=i)
    cv = cfg['cover']
    make_cover(prs, layouts, cv['title'], cv['subtitle'], cv['desc'], cv['edition'])
    new = list(ids)[-1]; ids.remove(new); ids.insert(0, new)
    for i in [1] + sorted(drop):
        sid = orig[i-1]; prs.part.drop_rel(sid.rId); ids.remove(sid)
    # drop embedded fonts of the retired families (keep Prompt)
    pe = prs.part._element
    ef = pe.find('p:embeddedFontLst', NS)
    if ef is not None:
        for f in list(ef):
            face = f.find('p:font', NS).get('typeface')
            if not face.startswith('Prompt'):
                rids = [k.get('{%s}id' % NS['r']) for k in f if k.get('{%s}id' % NS['r'])]
                ef.remove(f)
                for rid in rids: prs.part.drop_rel(rid)
        if len(ef) == 0: pe.remove(ef)
    prs.save(out)
    return log

if __name__ == '__main__':
    src, out, cfgpath = sys.argv[1:4]
    cfg = json.load(open(cfgpath))
    for i, row in enumerate(build(src, out, cfg), start=2): print(i, row)

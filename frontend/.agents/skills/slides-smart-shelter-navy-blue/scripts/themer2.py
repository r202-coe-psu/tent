"""Round 2: shorter band, no accent bars, bigger type, screenshots cropped to their content and enlarged."""
import glob, io, json, os, sys
from PIL import Image, ImageChops, ImageFont
import themer as T
from themer import NS, A, P, E, emu, NAVY, CERU, BG, MUTED, LINE, TINT, TINT2, FONT, NSD, etree, RT

# ---------- layouts (no accent bars, no footer rule, shorter band)
BAND_H = 0.95
def sldnum2(color): return T.ph(4, 'Slide number', 'sldNum', 12, 17.4, 10.68, 2.0, 0.4, 'r', 'ctr', T.defrpr(color, 1600, False), T.SLDNUM_FLD)
T.LAYOUTS['band'] = ('Content – Band', BG, 'titleOnly',
    T.rect(10, 'Header band', 0, 0, 20, BAND_H, NAVY)
    + T.ph(2, 'Title', 'title', 0, 0.6, 0.0, 18.8, BAND_H, 'l', 'ctr', T.defrpr('FFFFFF', 3600, True), T.label('Title'))
    + sldnum2(MUTED))
T.LAYOUTS['cover'] = ('Cover', NAVY, 'title',
    T.rect(10, 'Accent bar', 1.2, 3.5, 1.6, 0.08, CERU)
    + T.ph(2, 'Title', 'ctrTitle', 0, 1.2, 3.85, 16.4, 3.2, 'l', 't', T.defrpr('FFFFFF', 9600, True), T.label('Title'))
    + T.ph(3, 'Subtitle', 'subTitle', 1, 1.2, 6.0, 16.4, 1.2, 'l', 't', T.defrpr(TINT2, 7200, True), T.label('Subtitle'))
    + T.ph(5, 'Description', 'body', 13, 1.2, 7.75, 16.4, 1.5, 'l', 't', T.defrpr(TINT, 2400, False), T.label('Description'))
    + T.ph(6, 'Edition', 'body', 14, 1.2, 10.0, 12.0, 0.5, 'l', 'ctr', T.defrpr(TINT2, 2000, False), T.label('Edition'))
    + sldnum2(TINT2))
T.LAYOUTS['section'] = ('Section', NAVY, 'secHead', sldnum2(TINT2))
T.LAYOUT_SRC = {'cover': 0, 'band': 5, 'section': 2}

# content frame (inches)
X0, X1, Y0, Y1 = 0.6, 19.4, 1.35, 10.55
W = X1 - X0

# ---------- text measuring
def _prompt(style):
    dirs = [os.environ.get('SS_FONT_DIR', ''), os.path.expanduser('~/.local/share/fonts'), '/usr/share/fonts', '/Library/Fonts', os.path.expanduser('~/Library/Fonts')]
    for d in filter(None, dirs):
        hit = glob.glob(os.path.join(d, '**', f'Prompt-{style}.ttf'), recursive=True)
        if hit: return hit[0]
    sys.exit(f'Prompt-{style}.ttf not found: install the Prompt font or set SS_FONT_DIR')
_FONT = ImageFont.truetype(_prompt('Regular'), 200)
def width_in(s, pt): return _FONT.getlength(s) / 200 * pt / 72 * 1.14
def n_lines(text, wid, pt):
    if not text: return 1
    lines, cur = 1, ''
    for ch in text:
        if width_in(cur + ch, pt) > wid and cur:
            lines += 1; cur = ch
        else: cur += ch
    return lines
LH = 1.5
def text_h(paras, wid, pt): return sum(n_lines(p, wid, pt) for p in paras) * pt * LH / 72

A_ = T.A
def paras_of(sh): return [''.join(t.text or '' for t in p.iter(A_+'t')) for p in sh._element.iter(A_+'p')]
def set_sizes(sh, pt, ratio=LH):
    for r in sh._element.iter(A_+'rPr', A_+'endParaRPr'):
        if r.get('sz'): r.set('sz', str(int(pt*100)))
    for sp in sh._element.iter(A_+'spcPts'):
        if sp.getparent().tag == A_+'lnSpc': sp.set('val', str(int(round(pt*ratio*100))))
def scale_sizes(el, f):
    for r in el.iter(A_+'rPr', A_+'endParaRPr', A_+'defRPr'):
        if r.get('sz'): r.set('sz', str(max(1000, int(round(int(r.get('sz'))*f/50)*50))))
    for sp in el.iter(A_+'spcPts'):
        sp.set('val', str(int(round(int(sp.get('val'))*f))))
    for bp in el.iter(A_+'bodyPr'):
        for k in ('lIns','tIns','rIns','bIns'):
            if bp.get(k): bp.set(k, str(int(int(bp.get(k))*f)))

def blip_of(sh):
    bf = sh._element.find('p:spPr/a:blipFill', NS)
    return bf

def crop_box(blob):
    im = Image.open(io.BytesIO(blob)).convert('RGB')
    w, h = im.size
    bg = im.getpixel((4, 4))
    diff = ImageChops.difference(im, Image.new('RGB', im.size, bg)).convert('L').point(lambda p: 255 if p > 14 else 0)
    bb = diff.getbbox() or (0, 0, w, h)
    pad = 16
    l, t, r, b = max(0, bb[0]-pad), max(0, bb[1]-pad), min(w, bb[2]+pad), min(h, bb[3]+pad)
    return (l, t, r, b), (w, h)

def th(boxes, wid, pt):
    return sum(text_h(b, wid, pt) for b in boxes) + 0.22 * max(0, len(boxes) - 1)

def plan_shot(asp, steps, note):
    best = None
    for Fb in (30, 28, 26, 24):
        Fn = min(Fb, 26)
        Hn = text_h(note, W, Fn) if note else 0
        Hr = (Y1 - Y0) - Hn - (0.3 if note else 0)
        # A: side by side
        wi = min(Hr*asp, W - 0.4 - 5.0) if steps else min(Hr*asp, W)
        while wi >= 4:
            wt = W - 0.4 - wi
            ht = th(steps, wt, Fb) if steps else 0
            if ht <= Hr - 0.25:
                cand = ('A', Fb, Fn, wi, wi/asp, wt, ht, Hn, Hr); break
            wi -= 0.1
        else: cand = None
        if cand:
            s = cand[3]*cand[4]*(Fb/30)**2
            if best is None or s > best[0]: best = (s, cand)
        # B: stacked
        ht = th(steps, W, Fb) if steps else 0
        hi = Hr - ht - 0.55
        if hi >= 3:
            wi = min(hi*asp, W); hi = wi/asp
            cand = ('B', Fb, Fn, wi, hi, W, ht, Hn, Hr)
            s = wi*hi*(Fb/30)**2
            if best is None or s > best[0]: best = (s, cand)
    return best[1] if best else None


def text_items(shapes, ky=1.0, oy=0.0, kx=1.0, bottom=None):
    """yield (shape, abs width in, room below the shape inside its top-level container in, or None)"""
    for sh in shapes:
        top_level = bottom is None
        if sh.shape_type == 6:
            ce = sh._element.find('p:grpSpPr/a:xfrm/a:chExt', NS)
            co = sh._element.find('p:grpSpPr/a:xfrm/a:chOff', NS)
            kx2 = kx * (sh.width / int(ce.get('cx')) if int(ce.get('cx')) else 1.0)
            ky2 = ky * (sh.height / int(ce.get('cy')) if int(ce.get('cy')) else 1.0)
            ay = oy + sh.top * ky          # absolute top of this group
            oy2 = ay - int(co.get('y')) * ky2
            bot = (ay + sh.height * ky) if top_level else bottom
            yield from text_items(sh.shapes, ky2, oy2, kx2, bot)
        elif sh.has_text_frame and sh.text_frame.text.strip():
            room = None if bottom is None else (bottom - (oy + sh.top * ky)) / E
            yield sh, sh.width / E * kx, room

BUMPS = [(32, 28), (30, 26), (28, 24), (26, 22), (24, 20), (24, 18)]   # (title/label size, body size)

def pick_bump(content, fx, fy):
    items = []
    for sh, w, room in text_items(content):
        paras = []
        for p in sh._element.iter(A_+'p'):
            txt = ''.join(t.text or '' for t in p.iter(A_+'t'))
            r = p.find('a:r/a:rPr', NS)
            if txt and r is not None and r.get('sz'):
                pt = int(r.get('sz'))/100
                paras.append((txt, pt, n_lines(txt, w, pt)))
        if paras: items.append((w, room, paras))
    for big, small in BUMPS:
        ok = True
        for w, room, paras in items:
            need = 0
            for t, pt, n0 in paras:
                npt = big if pt >= 24 else small
                n = n_lines(t, w*fx*(0.80 if pt >= 24 else 1.0), npt)
                if pt >= 24 and n > n0: ok = False
                need += n * npt * LH / 72
            if room is not None and need > room*fy - 0.1: ok = False
        if ok: return big, small
    return BUMPS[-1]

DARK_BG = {'0F766E','0B2545','0E2A47','083F3B','1E3A5F','13315C'}
def has_content(sh):
    el = sh._element
    return any((t.text or '').strip() for t in el.iter(A_+'t')) or el.find('.//a:blip', NS) is not None

def find_nested_title(shapes, ky=1.0, oy=0.0):
    best = None
    for sh in shapes:
        cand = None
        if sh.shape_type == 6:
            ce = sh._element.find('p:grpSpPr/a:xfrm/a:chExt', NS); co = sh._element.find('p:grpSpPr/a:xfrm/a:chOff', NS)
            ky2 = ky * (sh.height / int(ce.get('cy')) if int(ce.get('cy')) else 1.0)
            ay = oy + sh.top * ky
            cand = find_nested_title(sh.shapes, ky2, ay - int(co.get('y')) * ky2)
        elif sh.has_text_frame and sh.text_frame.text.strip():
            ay = oy + sh.top * ky
            if T.maxsz(sh) >= 3600 and ay / E < 3.0: cand = (T.maxsz(sh), ay, sh)
        if cand and (best is None or cand[0] > best[0]): best = cand
    return best

def restyle_slide(prs, slide, layouts, notitle=False, log=None, cfg=None, idx=0):
    cfg = cfg or {}
    tree = slide.shapes._spTree
    SW, SH = prs.slide_width, prs.slide_height
    # explicit deletions the owner asked for / chrome of the old deck
    for sh in list(slide.shapes):
        txt = ''.join(x.text or '' for x in sh._element.iter(A_+'t')).strip()
        drop = any(txt.startswith(x) for x in cfg.get('delete_text', {}).get(str(idx), []))
        if cfg.get('strip_footer') and txt and sh.top > emu(10.2) and (txt.startswith('PSU Smart Shelter ·') or txt.isdigit()): drop = True
        if drop: tree.remove(sh._element)
    # slide-level background: dark = section slide, anything else inherits the layout
    bg = slide._element.find('p:cSld/p:bg', NS)
    bgc = bg.find('.//a:srgbClr', NS).get('val') if bg is not None and bg.find('.//a:srgbClr', NS) is not None else None
    light_slide = idx in cfg.get('light_slides', [])
    section = bgc in DARK_BG and not light_slide
    if bg is not None: bg.getparent().remove(bg)
    recolor_light = light_slide
    shapes = list(slide.shapes)
    def edge(s):
        return s.left <= emu(0.05) or s.top <= emu(0.05) or s.left+s.width >= SW-emu(0.05) or s.top+s.height >= SH-emu(0.05)
    def is_deco(s):
        if has_content(s): return False
        if (s.height >= SH*0.95 and s.width < emu(1.5)) or (s.width >= SW*0.95 and s.height < emu(0.5)): return True
        if s.width >= SW*0.95 and s.height >= SH*0.95: return True
        if s.width >= emu(10) and s.height <= emu(0.25): return True
        return edge(s) and max(s.width, s.height) < emu(3.5)
    deco = [s for s in shapes if is_deco(s)]
    texts = [s for s in shapes if s.has_text_frame and s.text_frame.text.strip() and s not in deco]
    title_sh = None if notitle or section or not texts else max(texts, key=T.maxsz)
    if title_sh is not None and T.maxsz(title_sh) < 3600: title_sh = None
    content = [s for s in shapes if s is not title_sh and s not in deco]
    if title_sh is None and cfg.get('nested_title') and not notitle and not section:
        found = find_nested_title(content)
        if found:
            nested = found[2]
            title_paras = T.para_texts(nested)
            nested._element.getparent().remove(nested._element)
        else: title_paras = []
    else:
        title_paras = T.para_texts(title_sh) if title_sh is not None else []
    any_pic = any(s._element.find('.//a:blip', NS) is not None for s in content)
    keep = section or (any_pic and not cfg.get('free_sizes'))
    layouts_key = 'section' if section else 'band'
    mode = 'zoom'
    cluster = None
    if any_pic and not section and not cfg.get('no_plan'):
        picshapes = [s for s in content if s._element.find('.//a:blip', NS) is not None]
        pl = min(s.left for s in picshapes); pt_ = min(s.top for s in picshapes)
        pr = max(s.left+s.width for s in picshapes); pb = max(s.top+s.height for s in picshapes)
        pad = emu(0.1)
        def inside(s):
            cx, cy = s.left + s.width/2, s.top + s.height/2
            return any(p.left-pad <= cx <= p.left+p.width+pad and p.top-pad <= cy <= p.top+p.height+pad for p in picshapes)
        overlays = [s for s in content if s not in picshapes and inside(s)]
        rest = [s for s in content if s not in picshapes and s not in overlays]
        if all(s.has_text_frame and s.text_frame.text.strip() for s in rest):
            cluster = (picshapes, overlays, rest)
    if cluster:
        picshapes, overlays, rest = cluster
        members = picshapes + overlays
        for s in members: T.restyle(s._element, recolor_light=recolor_light, keep_sizes=True)
        for s in rest: T.restyle(s._element, recolor_light=recolor_light, keep_sizes=False)
        cl_ = min(s.left for s in members); ct_ = min(s.top for s in members)
        cr_ = max(s.left+s.width for s in members); cb_ = max(s.top+s.height for s in members)
        cw, ch = (cr_-cl_)/E, (cb_-ct_)/E
        crop = None
        if len(picshapes) == 1 and not overlays and picshapes[0].shape_type != 6 and blip_of(picshapes[0]) is not None:
            pic = picshapes[0]
            rid = blip_of(pic).find('a:blip', NS).get('{%s}embed' % NS['r'])
            (cl, ct, cr, cb), (iw, ih) = crop_box(slide.part.related_part(rid).blob)
            if (cl, ct, cr, cb) != (0, 0, iw, ih): crop = (rid, (cl, ct, cr, cb))
            asp = (cr-cl) / (cb-ct)
        else:
            asp = cw / ch
        note = next((s for s in rest if s.width > emu(15) and s.top > cb_ - emu(0.3)), None)
        steps = sorted([s for s in rest if s is not note], key=lambda s: (s.top, s.left))
        plan = plan_shot(asp, [paras_of(s) for s in steps], paras_of(note) if note is not None else [])
        if plan:
            kind, Fb, Fn, wi, hi, wt, ht, Hn, Hr = plan
            gh = max(hi, ht) if kind == 'A' else hi + 0.3 + ht
            y0 = Y0 + max(0, (Hr - gh)/2)
            if crop:
                rid, (cl, ct, cr, cb) = crop
                im = Image.open(io.BytesIO(slide.part.related_part(rid).blob)).convert('RGB').crop((cl, ct, cr, cb))
                buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); buf.seek(0)
                _, new_rid = slide.part.get_or_add_image_part(buf)
                blip_of(picshapes[0]).find('a:blip', NS).set('{%s}embed' % NS['r'], new_rid)
                slide.part.drop_rel(rid)
                picshapes[0].left, picshapes[0].top, picshapes[0].width, picshapes[0].height = emu(X0), emu(y0), emu(wi), emu(hi)
            else:
                sc = wi / cw
                for s in members:
                    s.left = emu(X0) + int((s.left - cl_) * sc); s.top = emu(y0) + int((s.top - ct_) * sc)
                    s.width = int(s.width * sc); s.height = int(s.height * sc)
                    scale_sizes(s._element, sc)
            yy = y0 if kind == 'A' else y0 + hi + 0.3
            xx = X0 + wi + 0.4 if kind == 'A' else X0
            for sbox in steps:
                hb = text_h(paras_of(sbox), wt, Fb)
                set_sizes(sbox, Fb)
                sbox.left, sbox.top, sbox.width, sbox.height = emu(xx), emu(yy), emu(wt), emu(hb + 0.05)
                yy += hb + 0.22
            if note is not None:
                set_sizes(note, Fn)
                note.left, note.top, note.width, note.height = emu(X0), emu(Y1 - Hn), emu(W), emu(Hn + 0.05)
            mode = 'shot-' + kind + ' Fb%d img %.1fx%.1f%s' % (Fb, wi, hi, ' cluster' if (overlays or len(picshapes) > 1) else '')
    if mode == 'zoom':
        for s in content: T.restyle(s._element, recolor_light=recolor_light, keep_sizes=keep)
    if mode == 'zoom' and section:
        mode = 'section'      # composition kept as designed; colours/fonts already mapped
    elif mode == 'zoom' and keep:
        # picture slides with overlays: one uniform scale so callouts stay on their targets
        l = min(s.left for s in content); t = min(s.top for s in content)
        r_ = max(s.left+s.width for s in content); b = max(s.top+s.height for s in content)
        bw, bh = (r_-l)/E, (b-t)/E
        f = min(W/bw, (Y1-Y0-0.1)/bh, 1.7)
        x_off = X0 + (W - bw*f)/2
        for s in content:
            s.left = emu(x_off) + int((s.left-l)*f); s.top = emu(Y0+0.1) + int((s.top-t)*f)
            s.width = int(s.width*f); s.height = int(s.height*f)
            scale_sizes(s._element, f)
        mn = min([int(r.get('sz')) for s in content for r in s._element.iter(A_+'rPr') if r.get('sz')] or [0])/100
        mode = 'zoomU f%.2f min%.0fpt' % (f, mn)
    elif mode == 'zoom':
        l = min(s.left for s in content); t = min(s.top for s in content)
        r_ = max(s.left+s.width for s in content); b = max(s.top+s.height for s in content)
        bw, bh = (r_-l)/E, (b-t)/E
        fx, fy = min(1.5, W/bw), min(1.5, (Y1-Y0-0.2)/bh)
        big, small = pick_bump(content, fx, fy)
        for s in content:
            s.left = emu(X0) + int((s.left-l)*fx); s.top = emu(Y0+0.2) + int((s.top-t)*fy)
            s.width = int(s.width*fx); s.height = int(s.height*fy)
            for p in s._element.iter(A_+'p'):
                r = p.find('a:r/a:rPr', NS)
                base = int(r.get('sz'))/100 if r is not None and r.get('sz') else None
                if base is None: continue
                npt = big if base >= 24 else small
                for rr in p.iter(A_+'rPr', A_+'endParaRPr'):
                    if rr.get('sz'): rr.set('sz', str(int(npt*100)))
                sp = p.find('a:pPr/a:lnSpc/a:spcPts', NS)
                if sp is not None: sp.set('val', str(int(npt*LH*100)))
            for bp in s._element.iter(A_+'bodyPr'): pass
        ft = big
        mode = 'zoom fx%.2f fy%.2f sizes %d/%d' % (fx, fy, big, small)
    if title_sh is not None: tree.remove(title_sh._element)
    for d in deco: tree.remove(d._element)
    for rel in slide.part.rels.values():
        if rel.reltype == RT.SLIDE_LAYOUT: rel._target = layouts[layouts_key].part
    if title_paras:
        ttl = ' '.join(x.strip() for x in title_paras if x.strip())
        tpt = next((S for S in (36, 32, 30, 28, 26, 24) if lines_bold(ttl, 18.6, S) == 1), 24)
        szattr = '' if tpt == 36 else ' sz="%d"' % (tpt*100)
        paras = '<a:p><a:r><a:rPr lang="th-TH"%s/><a:t>%s</a:t></a:r></a:p>' % (szattr, ttl.replace('&','&amp;').replace('<','&lt;'))
        tree.find('p:grpSpPr', NS).addnext(etree.fromstring(
            f'<p:sp {NSD}><p:nvSpPr><p:cNvPr id="900" name="Title 900"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp>'))
    tree.append(etree.fromstring(
        f'<p:sp {NSD}><p:nvSpPr><p:cNvPr id="901" name="Slide Number Placeholder 901"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>{T.SLDNUM_FLD}</a:p></p:txBody></p:sp>'))
    if log is not None: log.append(mode)


_BOLD = ImageFont.truetype(_prompt('Bold'), 200)
def lines_bold(text, wid, pt):
    cur, n = '', 1
    for ch in text:
        if _BOLD.getlength(cur + ch) / 200 * pt / 72 * 1.04 > wid and cur: n += 1; cur = ch
        else: cur += ch
    return n

def make_cover(prs, layouts, title_lines, subtitle, desc_lines, edition):
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.dml.color import RGBColor
    title = ''.join(title_lines)
    size = None
    for S in (96, 88, 80, 72):
        if lines_bold(title, 16.4, S) == 1: size = S; break
    if size is None:
        for S in (80, 72, 64, 56, 48, 44):
            if lines_bold(title, 16.4, S) <= 2: size = S; break
    size = size or 40
    nl = lines_bold(title, 16.4, size)
    th = nl * size * 1.45 / 72
    sub_y = 3.85 + th + 0.22
    desc_y = sub_y + 1.75
    slide = prs.slides.add_slide(layouts['cover'])
    ph_by = {p.placeholder_format.idx: p for p in slide.placeholders}
    def fill(p, lines, sz=None):
        tf = p.text_frame; tf.text = lines[0]
        for x in lines[1:]: tf.add_paragraph().text = x
        if sz:
            for para in tf.paragraphs:
                for r in para.runs: r.font.size = sz
    from pptx.util import Pt
    sub_sz = next((S for S in (72, 64, 56, 48, 44, 40, 36) if lines_bold(subtitle, 16.4, S) == 1), 36)
    fill(ph_by[0], [title], Pt(size)); fill(ph_by[1], [subtitle], Pt(sub_sz)); fill(ph_by[14], [edition])
    if desc_lines: fill(ph_by[13], desc_lines)
    else: ph_by[13]._element.getparent().remove(ph_by[13]._element)
    ph_by[0].left, ph_by[0].top, ph_by[0].width, ph_by[0].height = emu(1.2), emu(3.85), emu(16.4), emu(th + 0.1)
    ph_by[1].left, ph_by[1].top, ph_by[1].width, ph_by[1].height = emu(1.2), emu(sub_y), emu(16.4), emu(1.2)
    if desc_lines: ph_by[13].left, ph_by[13].top, ph_by[13].width, ph_by[13].height = emu(1.2), emu(desc_y), emu(16.4), emu(1.5)
    slide.shapes._spTree.append(etree.fromstring(
        f'<p:sp {NSD}><p:nvSpPr><p:cNvPr id="901" name="Slide Number Placeholder 901"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>{T.SLDNUM_FLD}</a:p></p:txBody></p:sp>'))
    badge = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(1.2), emu(1.0), emu(1.5), emu(1.5))
    badge.fill.solid(); badge.fill.fore_color.rgb = RGBColor(0xFF,0xFF,0xFF); badge.line.fill.background()
    badge.adjustments[0] = 0.18; badge.name = 'Logo badge'
    pic = slide.shapes.add_picture(T.LOGO, emu(1.4), emu(1.2), emu(1.1), emu(1.1)); pic.name = 'SmartShelter logo'
    pic._element.nvPicPr.cNvPr.set('descr', 'PSU Smart Shelter logo')
    return slide
T.make_cover = make_cover

T.restyle_slide = restyle_slide

if __name__ == '__main__':
    src, out, cfgpath = sys.argv[1:4]
    cfg = json.load(open(cfgpath))
    for i, row in enumerate(T.build(src, out, cfg), start=2): print(i, row)

import sys,zipfile,re,shutil
from lxml import etree
f=sys.argv[1]; tmp=f+'.tmp'
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
zi=zipfile.ZipFile(f); zo=zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED)
drop={'ppt/slides/slide1.xml','ppt/slides/_rels/slide1.xml.rels','ppt/notesSlides/notesSlide1.xml','ppt/notesSlides/_rels/notesSlide1.xml.rels'}
rm=0
for i in zi.infolist():
    n=i.filename; d=zi.read(n)
    if n in drop: continue
    if n=='[Content_Types].xml':
        d=re.sub(rb'<Override[^>]*PartName="/ppt/(slides/slide1|notesSlides/notesSlide1)\.xml"[^>]*/>',b'',d)
    elif re.fullmatch(r'ppt/slides/slide\d+\.xml',n):
        t=etree.fromstring(d)
        if t.xpath('//p:cNvPr[@name="Nav section" or @name="Nav label"]',namespaces=ns):
            for g in t.xpath('/p:sld/p:cSld/p:spTree/p:grpSp[p:nvGrpSpPr/p:cNvPr/@name="Group 2"]',namespaces=ns):
                for c in g.xpath('p:sp[p:nvSpPr/p:cNvPr/@id="3"]',namespaces=ns)[:1]:
                    if not ''.join(c.xpath('.//a:t/text()',namespaces=ns)).strip():
                        g.remove(c); rm+=1
            d=etree.tostring(t,xml_declaration=True,encoding='UTF-8',standalone=True)
    zo.writestr(i,d)
zo.close(); shutil.move(tmp,f); print('removed pills',rm)

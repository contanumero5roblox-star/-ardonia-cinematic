"""Create source and deployable ZIP files without credentials or dependencies."""
from pathlib import Path
import subprocess
import zipfile
root = Path(__file__).resolve().parent.parent
out = root / 'artifacts'
out.mkdir(exist_ok=True)
files = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'], cwd=root).split(b'\0')
with zipfile.ZipFile(out/'ardonia-cinematic-fonte.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for raw in files:
        if not raw: continue
        name = raw.decode()
        path = root/name
        if path.is_file(): archive.write(path, 'ardonia-cinematic/'+name)
with zipfile.ZipFile(out/'ardonia-cinematic-publicacao.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((root/'dist').rglob('*')):
        if path.is_file(): archive.write(path,path.relative_to(root/'dist'))
for name in ['ardonia-cinematic-fonte.zip','ardonia-cinematic-publicacao.zip']:
    with zipfile.ZipFile(out/name) as archive:
        assert archive.testzip() is None
        assert not any('/node_modules/' in n or '/.git/' in n for n in archive.namelist())
    print(name, (out/name).stat().st_size, 'bytes; ZIP íntegro')

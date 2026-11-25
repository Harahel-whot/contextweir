# Adds (or replaces) the credit header at the top of every text file in the tools folder,
# adds _about to the JSON files, and (since 24 Nov evening) also sets the version and build
# date everywhere else they are written, so they can never disagree:
#   VERSION and BUILT in contextweir.js and promptassay.js, the "versions 0.1 to x" credit in
#   each ABOUT, the "Version x (prototype), built y" line in each help.html (the README's versions are in its header line).
# Usage: edit BUILT and VER below, then   python3 headers.py <tools folder>   (safe to run again).
import json, os, re, sys
ROOT = sys.argv[1]
BUILT = '25 Nov 2026'
VER = {'contextweir': '0.6.0.0', 'promptassay': '0.4.1.0'}
NAME = {'contextweir': 'ContextWeir', 'promptassay': 'PromptAssay'}
DIRECTOR = 'Harahel-Whot'
MODEL = 'Claude Opus 5.5 (Anthropic)'
SOURCE = 'Source: https://github.com/Harahel-Whot/contextweir'
MARK = 'Wellspring tools'      # every header contains this; used to find and replace an old one

def lines_for(rel):
    top = rel.split('/')[0]
    if top in VER:
        first = f'{NAME[top]} {VER[top]}, built {BUILT}. Part of the {MARK}.'
    else:
        first = f'ContextWeir {VER["contextweir"]} and PromptAssay {VER["promptassay"]}, built {BUILT}. Part of the {MARK}.'
    doc = rel.endswith(('.html', '.svg', '.txt', '.css', '.md')) and not rel.endswith('ui.css') and not rel.endswith('app.css')
    lic = 'Licence: CC BY 4.0 (see LICENSE.txt).' if rel.endswith(('help.html', '.svg', 'README.txt', 'SECURITY.txt', '.md')) else 'Licence: MIT (see LICENSE.txt).'
    return [first, f'Directed by {DIRECTOR}. Written by {MODEL}.', f'{lic} {SOURCE}']

def wrap(rel, L):
    ext = os.path.splitext(rel)[1]
    if ext == '.js': return ''.join(f'// {l}\n' for l in L) + '\n'
    if ext == '.bat': return ''.join(f'rem {l}\n' for l in L)
    if ext in ('.sh', '.command'): return ''.join(f'# {l}\n' for l in L)
    if ext == '.css': return '/* ' + '\n   '.join(L) + ' */\n'
    if ext in ('.html', '.svg'): return '<!-- ' + '\n     '.join(L) + ' -->\n'
    if ext in ('.txt', '.md'): return ''.join(f'{l}\n' for l in L) + '\n'
    return None

HDR_RE = {  # an existing header block (so running twice replaces, not stacks)
    '.js': re.compile(r'(?:// [^\n]*\n){2}// [^\n]*Source: [^\n]*\n\n'),
    '.bat': re.compile(r'(?:rem [^\n]*\n){2}rem [^\n]*Source: [^\n]*\n'),
    '.sh': re.compile(r'(?:# [^\n]*\n){2}# [^\n]*Source: [^\n]*\n'),
    '.command': re.compile(r'(?:# [^\n]*\n){2}# [^\n]*Source: [^\n]*\n'),
    '.css': re.compile(r'/\* [^\n]*Wellspring tools[^*]*?\*/\n'),
    '.html': re.compile(r'<!-- [^\n]*Wellspring tools.*?-->\n', re.S),
    '.svg': re.compile(r'<!-- [^\n]*Wellspring tools.*?-->\n', re.S),
    '.txt': re.compile(r'[^\n]*Wellspring tools[^\n]*\n[^\n]*\n[^\n]*Source: [^\n]*\n\n'),
    '.md': re.compile(r'[^\n]*Wellspring tools[^\n]*\n[^\n]*\n[^\n]*Source: [^\n]*\n\n'),
}
done = []
for d, _, files in os.walk(ROOT):
    rel_d = os.path.relpath(d, ROOT).replace(os.sep, '/')
    if '/logs' in d or rel_d == 'dev' or rel_d.startswith('dev/'): continue   # logs and the dev files are not shipped
    if rel_d == 'demo' or rel_d.startswith('demo/'): continue                  # dev/make_demo.js stamps the demo itself
    if rel_d.endswith('schemas'): continue                                       # made by contextweir.js --schema (below)
    for f in files:
        p = os.path.join(d, f); rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        ext = os.path.splitext(f)[1]
        if f == 'LICENSE.txt' or f == 'running.json': continue
        if ext == '.json':
            j = json.load(open(p))
            L = lines_for(rel)
            j = {'_about': ' '.join(L), **{k: v for k, v in j.items() if k != '_about'}}
            open(p, 'w').write(json.dumps(j, indent=2) + '\n'); done.append(rel); continue
        L = lines_for(rel); h = wrap(rel, L)
        if h is None: continue
        crlf = ext == '.bat'
        s = open(p, newline='').read()
        if crlf: s = s.replace('\r\n', '\n')
        s = HDR_RE[ext].sub('', s, count=1)
        if ext in ('.sh', '.command'):
            first, rest = s.split('\n', 1); s = first + '\n' + h + rest
        elif ext == '.bat':
            first, rest = s.split('\n', 1); s = first + '\n' + h + rest   # after @echo off
        elif ext == '.html':
            first, rest = s.split('\n', 1); s = first + '\n' + h + rest   # after <!DOCTYPE html>
        elif ext == '.md':
            first, rest = s.split('\n', 1); s = first + '\n\n' + h + rest.lstrip('\n')   # after the "# title" line
        else:
            s = h + s
        if crlf: s = s.replace('\n', '\r\n')
        open(p, 'w', newline='').write(s); done.append(rel)
# Versions and build dates inside the files (not only in the headers).
def sub_file(rel, pattern, repl):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p): return
    s0 = open(p, newline='').read()
    s1 = re.sub(pattern, repl, s0)
    if s1 != s0: open(p, 'w', newline='').write(s1)
for tool, script in (('contextweir', 'contextweir/contextweir.js'), ('promptassay', 'promptassay/promptassay.js')):
    sub_file(script, r"const VERSION = '[^']*';", f"const VERSION = '{VER[tool]}';")
    sub_file(script, r"const BUILT = '[^']*';", f"const BUILT = '{BUILT}';")
    sub_file(script, r"versions: '0\.1 to [^']*'", f"versions: '0.1 to {VER[tool]}'")
    sub_file(f'{tool}/help.html', r'Version [0-9.]+ \(prototype\), built [0-9]+ [A-Z][a-z]+ [0-9]{4}', f'Version {VER[tool]} (prototype), built {BUILT}')
# The JSON Schemas are made by ContextWeir itself from its own lists, so they carry its version.
import subprocess
for kind in ('settings', 'rules', 'setup'):
    out = subprocess.run(['node', os.path.join(ROOT, 'contextweir', 'contextweir.js'), '--schema', kind],
                         capture_output=True, text=True, check=True).stdout
    os.makedirs(os.path.join(ROOT, 'contextweir', 'schemas'), exist_ok=True)
    open(os.path.join(ROOT, 'contextweir', 'schemas', f'{kind}.schema.json'), 'w', newline='\n').write(out)
print(len(done), 'files'); print('\n'.join(sorted(done)))

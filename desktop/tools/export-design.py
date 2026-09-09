#!/usr/bin/env python3
"""Export the read-only design constants; --check never writes."""
import argparse
import contextlib
import datetime
import hashlib
import importlib
import io
import json
import os
import pathlib
import sys
import traceback

DESIGN = os.environ.get('TERUM_DESIGN_DIR')
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAMES = ['TOKENS', 'SKILLS', 'INBOX', 'CATALOG', 'MARKET_EXTRA', 'PEOPLE', 'ROSTER_MORE', 'ROSTER', 'PROJECTS', 'MEMBER', 'INVITED', 'CATEGORIES', 'DETAIL', 'DETAIL_PARTIAL', 'DETAIL_NO_RECEIPT', 'DETAIL_NOT_INSTALLED', 'AUTHOR_OF', 'LIST_OF', 'COUNTS', 'KINDS', 'CATALOG_N', 'TEAM_N', 'HOVER_INDEX', 'INBOX_UNREAD', 'PROVENANCE', 'K', 'DEFAULT_CASES', 'RYAN', 'AJAY', 'MIRA', 'KAI', 'TEDDY', 'LENA', 'TAB_ITEMS', 'METHOD', 'FILTER_DEFAULT', 'INVITEE', 'TEAM_REPO', 'INVITE_TIP', 'JOIN_BLOCK_NOTE', 'VERDICT_STYLE', 'INDICATORS', 'MACHINE', 'ME', 'TEAMS', 'TEAM_POLICY', 'PLACEMENTS', 'PLACEMENTS_N', 'PINNED_N', 'APPROVALS', 'QUARANTINE', 'SHARED', 'LOCAL_UNSHARED', 'HOOK', 'APP_VERSION', 'AGENT_CLI', 'COMMUNITY', 'STORAGE', 'SETTINGS_NAV', 'SHORTCUTS', 'INBOX_KIND_TEXT', 'THEME_OPTIONS', 'ONBOARD_STEPS', 'ONBOARD_BASICS', 'GLOBAL_SET', 'BOOT_STEPS', 'ONBOARD_LATER', 'ONBOARD_COMMUNITY', 'ONBOARD_FETCH_ERROR', 'WELCOME_LINES', 'BASICS_COPY', 'BASICS_HINT', 'ICON_PATHS', 'TERUM_MARK']
LAYOUT = ['FRAME_W', 'FRAME_H', 'TOPBAR_H', 'SIDEBAR_W', 'ROW_H', 'SECTION_H', 'NEST_INDENT', 'CARD_H', 'RAIL_W', 'CONTENT_W', 'REPORT_W', 'LIST_W', 'HERO_SEARCH_W', 'PROJECT_CARD_H', 'PERSON_CARD_H', 'MARKET_FULL_H', 'SETTINGS_NAV_W', 'SETTINGS_CONTENT_W', 'ONBOARD_W', 'ONBOARD_TOP', 'ONBOARD_PANEL_H', 'TILE_MIN_H', 'MEMBER_COLS', 'LIFT_COL', 'FIELD_H', 'FIELDS_GAP']

def serialise(value):
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, (tuple, set)):
        return list(value)
    raise TypeError(f'Unsupported design value: {type(value).__name__}')

EXTRA_NAMES = ['LIBRARY_OVERVIEW', 'OVERVIEW_BY_SCOPE', 'SKILL_MD_ID', 'SKILL_MD_BODY', 'CLI_VERSION', 'CLI_LATEST', 'FOLLOWING', 'SHARED_SPECIMEN', 'WORDS', 'P_BASE', 'P_INC', 'P_PARTIAL']

def derived(b):
    names = lambda rows: [s['name'] for s in rows]
    handles = lambda rows: [q['handle'] for q in rows]
    details = {d['name']: d for d in [b.DETAIL, b.DETAIL_PARTIAL, b.DETAIL_NO_RECEIPT]}
    details['deploy-check-not-installed'] = b.DETAIL_NOT_INSTALLED
    off = next(it for it in b.INBOX if it.get('sessions'))
    def receipt(s):
        r = b.receipt_of(s)
        return dict(r, sign_p=b.sign_p(r['w'], r['l'])) if r else None
    def incumbent(s):
        # build.py report_doc:1372 and report_update:2076, incumbent lift and sign test.
        v = (s.get('receipt') or {}).get('incumbent') or s.get('incumbent')
        if not v:
            return None
        w, l, t = v['wlt'] if isinstance(v, dict) else v
        return [round((w-l)/(w+l+t)*100), b.sign_p(w, l)]
    def report(s):
        # build.py report_doc:1367-1368; report_offtarget:2093-2098.
        r = b.receipt_of(s)
        holes = r['partial'][1] - r['partial'][0] if r and r['partial'] else 0
        tg = (s.get('receipt') or {}).get('triggers')
        result = dict(holes=holes, nRounds=(r['n'] if r else 0)+holes,
                      triggerTotal=tg['fp']+tg['tn'] if tg else 0)
        if 'sessions' in s:
            result['precisionObserved'] = f"{s['on_target']/s['sessions']:.2f}"
        return result
    docs = next(q for q in b.PROJECTS if q['key'] == 'docs')
    return dict(
        receipts={**{s['name']: receipt(s) for s in b.SKILLS+b.CATALOG+b.MARKET_EXTRA}, **{s['title']: receipt(s) for s in b.INBOX}},
        installs={s['name']: b.installs_of(s) for s in b.CATALOG},
        tokens={s['name']: b.tokens_of(s) for s in b.CATALOG},
        topRated=names(b.top_rated(len(b.CATALOG))),
        # build.py filters_popover:2874-2875.
        verdictCounts={v: sum(1 for s in b.CATALOG if (b.receipt_of(s) or {}).get('verdict', 'Not evaluated') == v) for v in ['PASS','NEUTRAL','FAIL','Not evaluated']},
        peopleByAdoption=handles(b.people_by_adoption()),
        adoption={q['handle']: b.adoption_of(q['handle']) for q in b.ROSTER},
        rosterByAdoption=handles(b.roster_by_adoption()),
        projectsByMembers=names(b.projects_by_members()),
        projectMembers={q['name']: handles(b.project_members(q)) for q in b.PROJECTS},
        skillsIn={q['name']: names(b.skills_in(q)) for q in b.PROJECTS},
        personBuckets={q['handle']: [[bucket, names(rows)] for bucket, rows in b.person_buckets(q['handle'])] for q in b.PEOPLE},
        categorySkills={key: names(b.category_skills(key)) for key, _, _ in b.CATEGORIES},
        filterCount=b.filter_count(),
        personPlaceNote={q['handle']: b.person_place_note(q) for q in b.PEOPLE},
        # build.py person_rail:3006.
        personOnDisk={q['handle']: [sum(1 for s in b.skills_by(q['handle']) if s.get('installed', True)), len(b.skills_by(q['handle']))] for q in b.PEOPLE},
        digest=b.digest_of(b.DETAIL, 9),
        digestSentence=b.digest_sentence(next(it for it in b.INBOX if it['kind']=='author')),
        evalEstimate=b.eval_estimate(b.DETAIL), evalEstimateText=b.eval_estimate_text(b.DETAIL), evalEstimateTip=b.eval_estimate_tip(b.DETAIL),
        evalCommand={ref: b.eval_command(d) for ref,d in details.items()},
        shareCommand={ref: b.share_command(d) for ref,d in details.items()},
        incumbentLift={**{s['name']: incumbent(s) for s in b.SKILLS+list(details.values()) if incumbent(s)}, **{s['title']: incumbent(s) for s in b.INBOX if incumbent(s)}},
        reportNumbers={**{ref: report(d) for ref,d in details.items()}, off['title']: report(off)},
        # build.py bulk_install_dialog:3051 and project_install:3059.
        bulkInstall={'docs': {'total': docs['skills'], 'asking': sum(1 for s in b.skills_in(docs) if s.get('grants'))}},
        # build.py category_row:3119.
        categoryRemaining={key: n-len(b.category_skills(key)) for key, _, n in b.CATEGORIES},
        # build.py view_header:332 (subtitle), parameterized by the scope COUNTS.
        libraryTitles={scope: b.COUNTS[scope]+' skills' for scope in ['Global','Terum','SSM','MRF']},
    )

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--design', type=pathlib.Path, default=pathlib.Path(DESIGN) if DESIGN else None)
    parser.add_argument('--tokens', type=pathlib.Path, default=pathlib.Path('src/styles/tokens.css'))
    parser.add_argument('--fixtures', type=pathlib.Path, default=pathlib.Path('src/fixtures/design.json'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    sys.dont_write_bytecode = True  # The design source tree is read-only.
    if args.design is None:
        print('export-design: TERUM_DESIGN_DIR is not set and --design was not given (the design folder is not part of this repository)', file=sys.stderr)
        return 2
    if not (args.design / 'build.py').is_file():
        print(f'export-design: no build.py under {args.design}', file=sys.stderr)
        return 2
    sys.path.insert(0, str(args.design))
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        build = importlib.import_module('build')
    if captured.getvalue():
        print('export-design: build.py printed on import')
        return 2
    digest = hashlib.md5((args.design / 'build.py').read_bytes()).hexdigest()
    data = {'generatedFrom': {'buildPy': digest, 'today': build.TODAY.isoformat()}}
    for name in NAMES:
        if not hasattr(build, name):
            raise ValueError('export-design: missing ' + name)
        value = getattr(build, name)
        # VERDICT_STYLE is the sole callable-valued source constant. Preserve its
        # actual per-theme outputs; function reprs contain unstable addresses.
        if name == 'VERDICT_STYLE':
            value = {key: {theme: fn(build.theme(theme)) for theme in ('dark', 'light', 'figma')}
                     for key, fn in value.items()}
        data[name] = value
    data['LAYOUT'] = {}
    for name in LAYOUT:
        if not hasattr(build, name):
            raise ValueError('export-design: missing ' + name)
        data['LAYOUT'][name] = getattr(build, name)
    for name in EXTRA_NAMES:
        data[name] = getattr(build, name)
    data['DERIVED'] = derived(build)
    fixtures = json.dumps(data, indent=2, ensure_ascii=False, default=serialise) + '\n'
    tokens = f'/* GENERATED by tools/export-design.py from build.py TOKENS (md5 {digest}) — do not edit by hand. */\n'
    for index, selector in enumerate([':root, :root[data-theme="dark"]', ':root[data-theme="light"]']):
        tokens += selector + ' {\n'
        tokens += ''.join(f'  --tk-{key}: {values[index]};\n' for key, values in build.TOKENS.items())
        tokens += '}\n'
    outputs = [(ROOT / args.tokens, tokens.encode()), (ROOT / args.fixtures, fixtures.encode())]
    if args.check:
        stale = [p for p, content in outputs if not p.exists() or p.read_bytes() != content]
        for path in stale:
            print(f'export-design: STALE {path} (run: python3 tools/export-design.py)')
        if stale:
            return 1
        print('export-design: tokens.css and design.json are current')
        return 0
    for path, content in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        if path.read_bytes() != content:
            raise OSError(f'Write verification failed: {path}')
    print(f'export-design: wrote {args.tokens} ({len(outputs[0][1])} bytes) and {args.fixtures} ({len(outputs[1][1])} bytes)')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)

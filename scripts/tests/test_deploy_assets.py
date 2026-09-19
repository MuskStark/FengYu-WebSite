"""Exercise the real Bash deployment paths with isolated Docker/Cloudflare fakes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
MOCK = r'''#!/usr/bin/env python3
import json, os, pathlib, shutil, sys, urllib.parse, zipfile
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
with (root / 'calls.jsonl').open('a') as f: f.write(json.dumps([name, *args]) + '\n')
base = os.environ.get('ASSETS_BASE_URL', 'https://assets.test')
def dist(dest):
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'assets').mkdir(exist_ok=True)
    (dest / 'assets/index-new.js').write_text('new javascript bytes')
    (dest / 'index.html').write_text('<script type="module" src="' + base + '/assets/index-new.js"></script>')
if name == 'uname': print('Linux')
elif name == 'git':
    if args[:2] == ['rev-parse', 'HEAD']: print('oldrevision')
    elif args[:2] == ['rev-parse', '--verify']: print('newrevision')
elif name == 'deploy-assets.sh':
    with (root / 'hook-image').open('w') as f: f.write(os.environ.get('DEPLOY_ASSETS_IMAGE', ''))
    if os.environ.get('HOOK_FAIL'): sys.exit(1)
elif name == 'npx':
    if 'create' in args and os.environ.get('CREATE_FAIL'):
        print('authentication failed', file=sys.stderr); sys.exit(1)
    if 'deploy' in args:
        shutil.copytree(args[-1], root / 'published', dirs_exist_ok=True)
elif name == 'docker':
    if 'ps' in args:
        target = args[-1]
        if target == os.environ.get('RUNNING_SERVICE'): print('running-container')
    elif args[:2] == ['image', 'inspect']: print('sha256:built-monitor')
    elif args[0] == 'inspect':
        if 'revision' in ' '.join(args): print('newrevision')
        elif 'Health' in ' '.join(args): print('healthy')
        else: print('sha256:running-image')
    elif args[0] == 'cp':
        with zipfile.ZipFile(args[-1], 'w') as z:
            z.writestr('BOOT-INF/classes/static/index.html', '<script type="module" src="' + base + '/assets/index-new.js"></script>')
            z.writestr('BOOT-INF/classes/static/assets/index-new.js', 'new javascript bytes')
    elif args[0] == 'run':
        for arg in args:
            if arg.startswith('ASSETS_BASE_URL='): base = arg.split('=', 1)[1]
        target = 'monitor-web' if '@infinia/monitor-web' in args[-1] else 'store-web'
        dist(root / target / 'dist')
elif name == 'curl':
    output = pathlib.Path(args[args.index('-o') + 1]) if '-o' in args else None
    url = next(a for a in args if a.startswith('https://') or a.startswith('http://'))
    if 'api.cloudflare.com' in url:
        output.write_text('{"success":true}'); print('200', end='')
    elif '/actuator/health' in url: print('{"status":"UP"}')
    elif output:
        if os.environ.get('BAD_PROBE'): output.write_text('<html>SPA fallback</html>')
        else:
            source = root / 'published' / urllib.parse.urlparse(url).path.lstrip('/')
            if not source.exists(): sys.exit(22)
            shutil.copyfile(source, output)
'''

class DeployAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        for name in ['deploy-assets.sh', 'pages-assets.mjs']:
            shutil.copyfile(SCRIPTS / name, self.root / 'scripts' / name)
        (self.root / 'bin').mkdir()
        for name in ['docker', 'npx', 'curl', 'sleep', 'git', 'uname', 'flock']:
            executable = self.root / 'bin' / name
            executable.write_text(MOCK)
            executable.chmod(0o755)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('ASSETS_', 'CLOUDFLARE_', 'DEPLOY_ASSETS_', 'PAGES_'))}
        self.env.update(PATH=str(self.root / 'bin') + ':' + os.environ['PATH'], FIXTURE_ROOT=str(self.root),
                        CLOUDFLARE_API_TOKEN='test-token', CLOUDFLARE_ACCOUNT_ID='test-account')

    def run_script(self, *args, success=True, **env):
        result = subprocess.run(['bash', str(self.root / 'scripts/deploy-assets.sh'), *args],
                                env={**self.env, **env}, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        calls = self.root / 'calls.jsonl'
        self.calls = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        return result

    def test_base_url_flag_and_correct_domain_api(self):
        self.run_script('--from-build', '--base-url', 'https://assets.test', '--fresh-project')
        api = next(c for c in self.calls if c[0] == 'curl' and '-X' in c)
        self.assertEqual(api[api.index('-X') + 1], 'POST')
        self.assertIn('https://api.cloudflare.com/client/v4/accounts/test-account/pages/projects/infinia-assets/domains', api)
        self.assertEqual(json.loads(api[api.index('--data') + 1]), {'name': 'assets.test'})

    def test_monitor_dedicated_root(self):
        self.run_script('--monitor', '--from-build', '--base-url', 'https://monitor-assets.test', '--fresh-project')
        self.assertTrue((self.root / 'published/assets/index-new.js').is_file())
        self.assertFalse((self.root / 'published/monitor').exists())

    def test_monitor_shared_path_and_previous_store_preserved(self):
        previous = self.root / 'previous'
        (previous / 'assets').mkdir(parents=True)
        (previous / 'index.html').write_text('store shell')
        (previous / 'assets/lazy-old.js').write_text('lazy store module')
        self.run_script('--monitor', '--from-build', '--base-url', 'https://assets.test/monitor',
                        '--previous-dist', str(previous))
        self.assertTrue(any('--project-name=infinia-assets' in c for c in self.calls))
        self.assertEqual((self.root / 'published/index.html').read_text(), 'store shell')
        self.assertTrue((self.root / 'published/monitor/assets/index-new.js').is_file())
        self.assertTrue((self.root / 'published/assets/lazy-old.js').is_file())

    def test_running_monitor_detection_uses_containers(self):
        (self.root / '.env').write_text('ASSETS_BASE_URL=https://assets.test/monitor\n')
        self.run_script('--fresh-project', RUNNING_SERVICE='monitor')
        self.assertTrue((self.root / 'published/monitor/index.html').is_file())
        self.assertTrue(any('store-monitor.jar' in ' '.join(c) for c in self.calls))
        self.assertFalse(any('--services' in c for c in self.calls))

    def test_flag_overrides_environment_for_image_build(self):
        self.run_script('--from-image', '--base-url', 'https://correct.test', '--fresh-project',
                        ASSETS_BASE_URL='https://wrong.test')
        self.assertIn('https://correct.test/assets', (self.root / 'published/index.html').read_text())

    def test_upgrade_image_does_not_rebuild(self):
        self.run_script('--from-image', '--base-url', 'https://assets.test', '--fresh-project', '--wait-assets',
                        DEPLOY_ASSETS_HOOK='1', DEPLOY_ASSETS_IMAGE='immutable:next')
        self.assertFalse(any('build' in c for c in self.calls))
        self.assertTrue(any('immutable:next' in c for c in self.calls))
        self.assertFalse((self.root / '.env').exists())

    def test_monitor_cutover_keeps_published_image(self):
        self.run_script('--monitor', '--from-image', '--base-url', 'https://assets.test/monitor', '--fresh-project', '--switch')
        self.assertIn('sha256:built-monitor', (self.root / '.monitor-release.yml').read_text())
        self.assertTrue(any('up' in c and '--no-build' in c and '.monitor-release.yml' in c for c in self.calls))

    def test_html_fallback_does_not_allow_cutover(self):
        self.run_script('--from-image', '--base-url', 'https://assets.test', '--fresh-project', '--switch', success=False, BAD_PROBE='1')
        self.assertFalse(any('up' in c for c in self.calls))

    def test_project_creation_auth_error_stops_publish(self):
        self.run_script('--from-build', '--base-url', 'https://assets.test', '--fresh-project', success=False, CREATE_FAIL='1')
        self.assertFalse(any(c[0] == 'npx' and 'deploy' in c for c in self.calls))

    def test_complete_dist_publish_generates_manifest(self):
        dist = self.root / 'complete'
        dist.mkdir()
        (dist / 'index.html').write_text('complete shell')
        self.run_script('--dist', str(dist))
        self.assertTrue((self.root / 'published/infinia-assets-manifest.json').is_file())
        self.assertFalse(any('run' in c for c in self.calls))

    def test_configure_saves_resolved_flag(self):
        result = subprocess.run(['bash', str(self.root / 'scripts/deploy-assets.sh'), '--configure', '--base-url', 'https://flag.test'],
                                env=self.env, input='Y\n', capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('ASSETS_BASE_URL=https://flag.test', (self.root / 'deploy.conf').read_text())

    def check_upgrade(self, monitor, fail=False):
        # Bypass only the root check in this isolated copy; every external
        # host-mutating command is a fake. Execute the actual upgrade flow.
        upgrade = (SCRIPTS / 'upgrade.sh').read_text().replace('${EUID}', '0')
        (self.root / 'scripts/upgrade.sh').write_text(upgrade)
        hook = self.root / 'scripts/deploy-assets.sh'
        hook.write_text(MOCK)
        hook.chmod(0o755)
        (self.root / '.env').write_text('ASSETS_BASE_URL=https://assets.test' + ('/monitor' if monitor else '') + '\n')
        (self.root / '.git').mkdir()
        (self.root / 'docker-compose.yml').touch()
        (self.root / 'docker-compose.monitor.yml').touch()
        args = ['--monitor'] if monitor else []
        result = subprocess.run(['bash', str(self.root / 'scripts/upgrade.sh'), *args],
                                env={**self.env, 'RUNNING_SERVICE': 'monitor' if monitor else 'store',
                                     'HOOK_FAIL': '1' if fail else ''},
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode == 0, not fail, result.stdout + result.stderr)
        calls = [json.loads(line) for line in (self.root / 'calls.jsonl').read_text().splitlines()]
        publish = next(i for i, c in enumerate(calls) if c[0] == 'deploy-assets.sh')
        switch = next(i for i, c in enumerate(calls) if c[0] == 'docker' and 'up' in c)
        self.assertLess(publish, switch)
        self.assertIn('--wait-assets', calls[publish])
        self.assertEqual((self.root / 'hook-image').read_text(), 'infinia-monitor:newrevision' if monitor else 'infinia-webservice')
        if fail:
            self.assertIn('rolled back', result.stdout + result.stderr)
        else:
            self.assertIn('--no-build', calls[switch])

    def test_store_upgrade_publishes_before_switch(self):
        self.check_upgrade(False)

    def test_monitor_upgrade_publishes_before_switch(self):
        self.check_upgrade(True)

    def test_store_upgrade_rolls_back_on_publish_failure(self):
        self.check_upgrade(False, fail=True)

    def test_monitor_upgrade_rolls_back_on_publish_failure(self):
        self.check_upgrade(True, fail=True)

    def test_invalid_origin_fails_before_build(self):
        self.run_script('--from-build', '--base-url', 'httpx://broken', '--fresh-project', success=False)
        self.assertFalse(any('run' in c for c in self.calls))

if __name__ == '__main__':
    unittest.main()

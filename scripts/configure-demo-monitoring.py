#!/usr/bin/env python3
"""Prepare a resource-version-guarded, demo-only Prometheus configuration change.
Requires PyYAML. Never changes app configuration, replicas or existing rules.
Default is prepare-only; --apply and --restart are explicit operator actions.
"""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import tempfile
import yaml

ROOT = Path(__file__).resolve().parents[1]
KUBE = ['kubectl', '--context', 'docker-desktop', '-n', 'deployforge-monitoring']
p = argparse.ArgumentParser()
g = p.add_mutually_exclusive_group(required=True)
g.add_argument('--enable', action='store_true')
g.add_argument('--disable', action='store_true')
p.add_argument('--apply', action='store_true')
p.add_argument('--restart', action='store_true')
a = p.parse_args()
if a.restart and not a.apply:
    p.error('--restart requires --apply')
cm = json.loads(subprocess.check_output(KUBE + ['get', 'configmap', 'prometheus-config', '-o', 'json']))
backup = Path(tempfile.mkdtemp(prefix='deployforge-demo-monitoring-'))
(backup / 'original-configmap.json').write_text(json.dumps(cm, indent=2))
config = yaml.safe_load(cm['data']['prometheus.yml'])
rules = yaml.safe_load(cm['data']['alerts.yml'])
job = yaml.safe_load((ROOT / 'k8s/demo/monitoring-probe.yaml').read_text())
group = yaml.safe_load((ROOT / 'k8s/demo/monitoring-alerts.yaml').read_text())
config['scrape_configs'] = [j for j in config['scrape_configs'] if j['job_name'] != job['job_name']]
rules['groups'] = [r for r in rules['groups'] if r['name'] != group['name']]
if a.enable:
    config['scrape_configs'].append(job)
    rules['groups'].append(group)
new_config = yaml.safe_dump(config, sort_keys=False)
new_rules = yaml.safe_dump(rules, sort_keys=False)
(backup / 'prometheus.yml').write_text(new_config)
(backup / 'alerts.yml').write_text(new_rules)
patch = [
    {'op': 'test', 'path': '/metadata/resourceVersion', 'value': cm['metadata']['resourceVersion']},
    {'op': 'replace', 'path': '/data/prometheus.yml', 'value': new_config},
    {'op': 'replace', 'path': '/data/alerts.yml', 'value': new_rules},
]
patch_file = backup / 'patch.json'
patch_file.write_text(json.dumps(patch))
print(json.dumps({'mode': 'enable' if a.enable else 'disable', 'backup': str(backup), 'patch': str(patch_file), 'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
if a.apply:
    subprocess.run(KUBE + ['patch', 'configmap', 'prometheus-config', '--type=json', '--patch-file', str(patch_file)], check=True)
if a.restart:
    subprocess.run(KUBE + ['rollout', 'restart', 'deployment/prometheus'], check=True)

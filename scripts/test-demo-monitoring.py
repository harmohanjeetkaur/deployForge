#!/usr/bin/env python3
"""Offline checks for bounded demo resources and optional monitoring config."""
from pathlib import Path
import subprocess
import yaml
ROOT = Path(__file__).resolve().parents[1]
for enabled in [False, True]:
    for scrapes in [False, True]:
        output = subprocess.check_output(['helm', 'template', 'test', str(ROOT/'helm/monitoring'), '--set', f'demoIncidents.enabled={str(enabled).lower()}', '--set', f'scrapesEnabled={str(scrapes).lower()}'], text=True)
        objects = list(yaml.safe_load_all(output))
        cm = next(o for o in objects if o['kind']=='ConfigMap' and o['metadata']['name']=='prometheus-config')
        config = yaml.safe_load(cm['data']['prometheus.yml']); rules = yaml.safe_load(cm['data']['alerts.yml'])
        assert any(j['job_name']=='demo-incident-probes' for j in config['scrape_configs']) == enabled
        assert any(g['name']=='deployforge-demo-incidents' for g in rules['groups']) == enabled
        assert any(j['job_name']=='application-probes' for j in config['scrape_configs']) == scrapes
for filename in ['incident.yaml', 'readiness.yaml']:
    for obj in yaml.safe_load_all((ROOT/'k8s/demo'/filename).read_text()):
        assert obj['metadata']['namespace']=='deployforge-gitops'
        if obj['kind']=='Deployment':
            spec=obj['spec']; pod=spec['template']['spec']; labels=spec['template']['metadata']['labels']
            assert spec['replicas']==1 and spec['strategy']['type']=='Recreate'
            assert labels['app.kubernetes.io/part-of']=='deployforge-incident-demo'
            assert 'app.kubernetes.io/instance' not in labels
            assert pod['automountServiceAccountToken'] is False
            assert pod['containers'][0]['resources']['limits']=={'cpu':'25m','memory':'32Mi'}
for local, chart in [('monitoring-probe.yaml','demo-probe.yml'),('monitoring-alerts.yaml','demo-alerts.yml')]:
    assert yaml.safe_load((ROOT/'k8s/demo'/local).read_text())==yaml.safe_load((ROOT/'helm/monitoring/files'/chart).read_text())
print('Passed: four Helm config combinations, demo-only selectors, resource caps, security context, and chart/source consistency.')

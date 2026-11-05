#!/usr/bin/env python3
"""Local Helm contracts and rule/dashboard query validation; no cluster writes.
Requires Python PyYAML, Helm and Docker (runs the pinned promtool image offline).
"""
import json, pathlib, subprocess, tempfile, yaml
ROOT = pathlib.Path(__file__).resolve().parents[1]
def render(chart, *flags):
    return list(yaml.safe_load_all(subprocess.check_output(['helm', 'template', 'deployforge' if chart == 'deployforge' else 'deployforge-monitoring', str(ROOT/'helm'/chart), '-n', 'deployforge-gitops' if chart == 'deployforge' else 'deployforge-monitoring', *flags], text=True)))
def promconfig(docs):
    return next(d['data'] for d in docs if d and d['kind'] == 'ConfigMap' and d['metadata']['name'] == 'prometheus-config')
def jobs(config):
    return yaml.safe_load(config['prometheus.yml'])['scrape_configs'] or []
def main():
    disabled = render('monitoring', '--set', 'scrapesEnabled=true')
    enabled = render('monitoring', '--set', 'scrapesEnabled=true', '--set', 'applicationMetrics.enabled=true')
    oldsum = next(d['spec']['template']['metadata']['annotations']['checksum-config'] for d in disabled if d.get('kind') == 'Deployment' and d['metadata']['name'] == 'prometheus')
    newsum = next(d['spec']['template']['metadata']['annotations']['checksum-config'] for d in enabled if d.get('kind') == 'Deployment' and d['metadata']['name'] == 'prometheus')
    assert oldsum != newsum, 'scrape opt-in must update the pod config checksum'
    assert 'DeployForgeHighHTTPErrorRate' not in promconfig(disabled)['alerts.yml']
    assert not any(j['job_name'] == 'deployforge-api' for j in jobs(promconfig(disabled)))
    api = next(j for j in jobs(promconfig(enabled)) if j['job_name'] == 'deployforge-api')
    assert api['metrics_path'] == '/metrics' and 'static_configs' not in api
    assert api['dns_sd_configs'] == [{'names': ['_http-metrics._tcp.deployforge-metrics.deployforge-gitops.svc.cluster.local'], 'type': 'SRV', 'refresh_interval': '30s'}]
    assert api['sample_limit'] == 5000 and api['body_size_limit'] == '2MB'
    assert not any(d.get('kind') in ['ClusterRole', 'ClusterRoleBinding'] for d in enabled)
    appoff, appon = render('deployforge'), render('deployforge', '--set', 'metrics.enabled=true')
    assert not any(d.get('metadata', {}).get('name') == 'deployforge-metrics' for d in appoff)
    svc = next(d for d in appon if d.get('metadata', {}).get('name') == 'deployforge-metrics')
    assert svc['spec']['clusterIP'] == 'None' and svc['spec']['type'] == 'ClusterIP'
    assert svc['spec']['ports'][0]['name'] == 'http-metrics'
    # Metric opt-in must not change the application pod spec or its image.
    assert next(d['spec'] for d in appoff if d['kind'] == 'Deployment') == next(d['spec'] for d in appon if d['kind'] == 'Deployment')
    dashboard = json.loads((ROOT/'helm/monitoring/files/dashboard.json').read_text())
    queries = {p['title']:p['targets'][0]['expr'] for p in dashboard['panels'] if p.get('targets')}
    required = ['API requests per second', 'API HTTP 5xx error ratio', 'API P95 response latency', 'API in-flight requests', 'Application availability — health probes']
    assert all(q in queries for q in required)
    assert 'sum by (le)' in queries['API P95 response latency'] and 'histogram_quantile(0.95' in queries['API P95 response latency']
    assert 'route!~"/healthz|/readyz"' in queries['API requests per second']
    tests = yaml.safe_load((ROOT/'helm/monitoring/tests/http-rules.test.yml').read_text())
    # Test actual provisioned queries; do not duplicate their implementation in assertions.
    vals = [('API requests per second', 1/6), ('API HTTP 5xx error ratio', 0.1), ('API P95 response latency', 0.3999999999999999), ('Application availability — health probes', 1)]
    tests['tests'][0]['promql_expr_test'] = [{'expr':queries[name], 'eval_time':'10m', 'exp_samples':[{'labels':'{}', 'value':value}]} for name,value in vals]
    tests['tests'][-1]['promql_expr_test'] = [{'expr':queries[name], 'eval_time':'3m', 'exp_samples':[]} for name in required]
    with tempfile.TemporaryDirectory(prefix='deployforge-observability-') as path:
        out = pathlib.Path(path)
        configs = promconfig(enabled)
        for key, value in configs.items(): (out/key).write_text(value)
        (out/'tests.yml').write_text(yaml.safe_dump(tests, allow_unicode=True))
        docker = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cpus', '1', '--memory', '128m', '--mount', f'type=bind,src={path},dst=/etc/prometheus,readonly', '--entrypoint', '/bin/promtool', 'prom/prometheus:v3.15.1']
        subprocess.run([*docker, 'check', 'config', '/etc/prometheus/prometheus.yml'], check=True)
        subprocess.run([*docker, 'test', 'rules', '/etc/prometheus/tests.yml'], check=True)
        # Validate every provisioned PromQL expression, including workload panels.
        for expr in queries.values():
            subprocess.run([*docker, '--experimental', 'promql', 'format', expr], check=True, stdout=subprocess.DEVNULL)
    print('PASS scrape opt-in, per-pod discovery, unchanged app pod spec, chart RBAC boundaries, rules and dashboard queries')
if __name__ == '__main__': main()

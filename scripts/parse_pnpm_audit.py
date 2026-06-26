import json
import os

def main():
    json_path = 'pnpm_report.json'
    html_path = 'frontend_safety_report.html'
    
    if not os.path.exists(json_path):
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write("<html><body><h3>No pnpm audit report found.</h3></body></html>")
        return

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(f"<html><body><h3>Error parsing pnpm audit report: {str(e)}</h3></body></html>")
        return

    vulns = data.get('vulnerabilities', {})
    metadata = data.get('metadata', {}).get('vulnerabilities', {})
    
    total = metadata.get('total', 0)
    low = metadata.get('low', 0)
    moderate = metadata.get('moderate', 0)
    high = metadata.get('high', 0)
    critical = metadata.get('critical', 0)

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Frontend Dependency Audit Report</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 40px; background-color: #f8f9fa; color: #333; }}
            h1 {{ color: #2c3e50; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px; }}
            .summary {{ display: flex; gap: 20px; margin-bottom: 30px; }}
            .card {{ flex: 1; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); background: white; text-align: center; }}
            .card.total {{ border-top: 5px solid #7f8c8d; }}
            .card.low {{ border-top: 5px solid #27ae60; }}
            .card.moderate {{ border-top: 5px solid #f39c12; }}
            .card.high {{ border-top: 5px solid #e67e22; }}
            .card.critical {{ border-top: 5px solid #c0392b; }}
            .card h3 {{ margin: 0 0 10px 0; color: #7f8c8d; text-transform: uppercase; font-size: 14px; }}
            .card .value {{ font-size: 32px; font-weight: bold; color: #2c3e50; }}
            table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
            th, td {{ padding: 15px; text-align: left; border-bottom: 1px solid #ecf0f1; }}
            th {{ background-color: #f1f2f6; color: #2c3e50; font-weight: 600; }}
            tr:hover {{ background-color: #f8f9fa; }}
            .severity {{ padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }}
            .severity.low {{ background-color: #d4edda; color: #155724; }}
            .severity.moderate {{ background-color: #fff3cd; color: #856404; }}
            .severity.high {{ background-color: #ffe8d6; color: #a04000; }}
            .severity.critical {{ background-color: #f8d7da; color: #721c24; }}
            a {{ color: #3498db; text-decoration: none; }}
            a:hover {{ text-decoration: underline; }}
        </style>
    </head>
    <body>
        <h1>Frontend Dependency Audit Report</h1>
        <div class="summary">
            <div class="card total"><h3>Total</h3><div class="value">{total}</div></div>
            <div class="card low"><h3>Low</h3><div class="value">{low}</div></div>
            <div class="card moderate"><h3>Moderate</h3><div class="value">{moderate}</div></div>
            <div class="card high"><h3>High</h3><div class="value">{high}</div></div>
            <div class="card critical"><h3>Critical</h3><div class="value">{critical}</div></div>
        </div>
        
        <h2>Vulnerable Packages</h2>
        <table>
            <thead>
                <tr>
                    <th>Package</th>
                    <th>Severity</th>
                    <th>Vulnerable Range</th>
                    <th>Vulnerabilities / Advisories</th>
                    <th>Fix Version</th>
                </tr>
            </thead>
            <tbody>
    """
    
    if not vulns:
        html_content += "<tr><td colspan='5' style='text-align: center; color: #7f8c8d;'>No vulnerabilities found! 🎉</td></tr>"
    else:
        for pkg_name, details in vulns.items():
            severity = details.get('severity', 'unknown')
            vuln_range = details.get('range', 'unknown')
            
            # Extract details about vulnerabilities
            advisories = []
            for via in details.get('via', []):
                if isinstance(via, dict):
                    title = via.get('title', 'Advisory')
                    url = via.get('url', '#')
                    advisories.append(f'<a href="{url}" target="_blank">{title}</a>')
                else:
                    advisories.append(str(via))
            
            advisories_str = ", ".join(advisories) if advisories else "N/A"
            
            fix_avail = details.get('fixAvailable', {})
            if isinstance(fix_avail, dict):
                fix_ver = fix_avail.get('version', 'N/A')
            elif isinstance(fix_avail, bool):
                fix_ver = "Available" if fix_avail else "N/A"
            else:
                fix_ver = str(fix_avail)
                
            html_content += f"""
                <tr>
                    <td><strong>{pkg_name}</strong></td>
                    <td><span class="severity {severity}">{severity}</span></td>
                    <td><code>{vuln_range}</code></td>
                    <td>{advisories_str}</td>
                    <td><code>{fix_ver}</code></td>
                </tr>
            """
            
    html_content += """
            </tbody>
        </table>
    </body>
    </html>
    """
    
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

if __name__ == '__main__':
    main()

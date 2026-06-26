import json
import os

def main():
    json_path = 'semgrep_report.json'
    html_path = 'frontend_sast_report.html'
    
    if not os.path.exists(json_path):
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write("<html><body><h3>No Semgrep scan report found.</h3></body></html>")
        return

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(f"<html><body><h3>Error parsing Semgrep report: {str(e)}</h3></body></html>")
        return

    results = data.get('results', [])
    
    # Calculate summary
    total = len(results)
    errors = sum(1 for r in results if r.get('extra', {}).get('severity') == 'ERROR')
    warnings = sum(1 for r in results if r.get('extra', {}).get('severity') == 'WARNING')
    infos = sum(1 for r in results if r.get('extra', {}).get('severity') == 'INFO')

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Frontend Codebase Security Scan (SAST) Report</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 40px; background-color: #f8f9fa; color: #333; }}
            h1 {{ color: #2c3e50; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px; }}
            .summary {{ display: flex; gap: 20px; margin-bottom: 30px; }}
            .card {{ flex: 1; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); background: white; text-align: center; }}
            .card.total {{ border-top: 5px solid #7f8c8d; }}
            .card.errors {{ border-top: 5px solid #c0392b; }}
            .card.warnings {{ border-top: 5px solid #f39c12; }}
            .card.infos {{ border-top: 5px solid #3498db; }}
            .card h3 {{ margin: 0 0 10px 0; color: #7f8c8d; text-transform: uppercase; font-size: 14px; }}
            .card .value {{ font-size: 32px; font-weight: bold; color: #2c3e50; }}
            .finding {{ background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border-left: 5px solid #7f8c8d; }}
            .finding.ERROR {{ border-left-color: #c0392b; }}
            .finding.WARNING {{ border-left-color: #f39c12; }}
            .finding.INFO {{ border-left-color: #3498db; }}
            .finding-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
            .finding-title {{ font-size: 18px; font-weight: bold; color: #2c3e50; }}
            .severity {{ padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }}
            .severity.ERROR {{ background-color: #f8d7da; color: #721c24; }}
            .severity.WARNING {{ background-color: #fff3cd; color: #856404; }}
            .severity.INFO {{ background-color: #d1ecf1; color: #0c5460; }}
            .finding-meta {{ font-size: 14px; color: #7f8c8d; margin-bottom: 10px; }}
            .finding-code {{ background-color: #f1f2f6; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 13px; overflow-x: auto; white-space: pre-wrap; margin-top: 10px; border: 1px solid #e1e2e6; }}
            .finding-message {{ font-size: 15px; color: #2c3e50; line-height: 1.5; }}
            .meta-label {{ font-weight: 600; color: #4b6584; }}
        </style>
    </head>
    <body>
        <h1>Frontend Codebase Security Scan (SAST) Report</h1>
        <div class="summary">
            <div class="card total"><h3>Total Findings</h3><div class="value">{total}</div></div>
            <div class="card errors"><h3>Errors</h3><div class="value">{errors}</div></div>
            <div class="card warnings"><h3>Warnings</h3><div class="value">{warnings}</div></div>
            <div class="card infos"><h3>Infos</h3><div class="value">{infos}</div></div>
        </div>
        
        <h2>Findings</h2>
    """
    
    if not results:
        html_content += "<div style='text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); color: #7f8c8d;'>No issues found! Your codebase is clean. 🎉</div>"
    else:
        for item in results:
            path = item.get('path', 'unknown')
            start_line = item.get('start', {}).get('line', 0)
            extra = item.get('extra', {})
            message = extra.get('message', 'No details available.')
            severity = extra.get('severity', 'INFO')
            code_lines = extra.get('lines', '')
            
            # Extract metadata
            metadata = extra.get('metadata', {})
            cwe = metadata.get('cwe', [])
            cwe_str = ", ".join(cwe) if isinstance(cwe, list) else str(cwe)
            owasp = metadata.get('owasp', [])
            owasp_str = ", ".join(owasp) if isinstance(owasp, list) else str(owasp)
            
            html_content += f"""
            <div class="finding {severity}">
                <div class="finding-header">
                    <div class="finding-title">{path}:{start_line}</div>
                    <span class="severity {severity}">{severity}</span>
                </div>
                <div class="finding-meta">
                    {f'<span class="meta-label">CWE:</span> {cwe_str} | ' if cwe_str else ''}
                    {f'<span class="meta-label">OWASP:</span> {owasp_str}' if owasp_str else ''}
                </div>
                <div class="finding-message">{message}</div>
                <div class="finding-code">{code_lines}</div>
            </div>
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

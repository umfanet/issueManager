from collections import Counter


def compare_issues(vendor_issues, system_issues, known_map=None):
    """Compare vendor and system issues by ID.

    Args:
        known_map: dict of issue ID -> {module, owner} from DB (used to detect Reopened vs New)

    Returns:
        dict with keys:
        - common: issues in both (with merged info)
        - vendor_only: issues only in vendor (completed/removed from system)
        - system_only: issues only in system (new/re-assigned/rejected)
    """
    known_map = known_map or {}
    vendor_by_id = {issue['IDWORKITEM']: issue for issue in vendor_issues}
    system_by_id = {issue['ID']: issue for issue in system_issues}

    vendor_ids = set(vendor_by_id.keys())
    system_ids = set(system_by_id.keys())

    common_ids = vendor_ids & system_ids
    vendor_only_ids = vendor_ids - system_ids
    system_only_ids = system_ids - vendor_ids

    # Common issues - merge vendor progress info with system data
    common = []
    for id_val in sorted(common_ids):
        v = vendor_by_id[id_val]
        s = system_by_id[id_val]
        # If system says Rejected, override vendor status to Reopened
        sys_status = (s.get('Status', '') or '').strip()
        status = 'Reopened' if sys_status.lower() == 'rejected' else v['Status']
        common.append({
            'ID': id_val,
            'HEADLINE': v['HEADLINE'] or s['Headline'],
            'Status': status,
            'Comments': v['Comments'],
            'Module': v['Module'] or 'N/A',
            'Owner': v['Owner'],
            'Days since Opened': s['Days since Opened'] or v['Days since Opened'],
            'Tag': s['Tag'] or v['Tag'],
            'System_Status': s['Status'],
            'Seriousness': s.get('Seriousness', ''),
            'Frequency': s.get('Frequency', ''),
        })

    # Vendor only - already handled in system
    vendor_only = []
    for id_val in sorted(vendor_only_ids):
        v = vendor_by_id[id_val]
        vendor_only.append({
            'ID': id_val,
            'HEADLINE': v['HEADLINE'],
            'Status': v['Status'],
            'Comments': v['Comments'],
            'Module': v['Module'] or 'N/A',
            'Owner': v['Owner'],
            'Days since Opened': v['Days since Opened'],
            'Tag': v['Tag'],
        })

    # System only - new or reopened
    system_only = []
    for id_val in sorted(system_only_ids):
        s = system_by_id[id_val]
        sys_status = (s.get('Status', '') or '').strip()
        prev = known_map.get(id_val)
        if sys_status.lower() == 'rejected' or prev:
            status = 'Reopened'
            module = prev.get('module', '') or 'N/A' if prev else 'N/A'
            owner = prev.get('owner', '') if prev else ''
        else:
            status = 'New'
            module = 'N/A'
            owner = ''
        system_only.append({
            'ID': id_val,
            'HEADLINE': s['Headline'],
            'Status': status,
            'Comments': [],
            'Module': module,
            'Owner': owner,
            'Days since Opened': s['Days since Opened'],
            'Tag': s['Tag'],
            'Seriousness': s.get('Seriousness', ''),
            'Frequency': s.get('Frequency', ''),
        })

    return {
        'common': common,
        'vendor_only': vendor_only,
        'system_only': system_only,
    }


def generate_statistics(result):
    """Generate statistics from comparison result."""
    common = result['common']
    vendor_only = result['vendor_only']
    system_only = result['system_only']

    all_active = common + system_only  # currently active issues

    # Summary counts - count New/Reopened from ALL active issues (common + system_only)
    new_count = sum(1 for i in all_active if i['Status'] == 'New')
    reopened_count = sum(1 for i in all_active if i['Status'] == 'Reopened')
    ongoing_count = len(all_active) - new_count - reopened_count
    summary = {
        'total_active': len(all_active),
        'common': ongoing_count,
        'resolved': len(vendor_only),
        'new': new_count,
        'reopened': reopened_count,
    }

    # Status breakdown (from active issues)
    status_counts = Counter(issue['Status'] for issue in all_active if issue['Status'])

    # Module breakdown
    module_counts = Counter(issue['Module'] for issue in all_active if issue['Module'])

    # Owner breakdown
    owner_counts = Counter(issue['Owner'] for issue in all_active if issue['Owner'])

    # Tag breakdown
    tag_counts = Counter(issue['Tag'] for issue in all_active if issue['Tag'])

    # Days since opened distribution
    days_distribution = {'0-7': 0, '8-14': 0, '15-30': 0, '31-60': 0, '60+': 0}
    for issue in all_active:
        days_str = issue.get('Days since Opened', '')
        if days_str:
            try:
                days = int(float(days_str))
                if days <= 7:
                    days_distribution['0-7'] += 1
                elif days <= 14:
                    days_distribution['8-14'] += 1
                elif days <= 30:
                    days_distribution['15-30'] += 1
                elif days <= 60:
                    days_distribution['31-60'] += 1
                else:
                    days_distribution['60+'] += 1
            except (ValueError, TypeError):
                pass

    return {
        'summary': summary,
        'status': dict(status_counts),
        'module': dict(module_counts),
        'owner': dict(owner_counts),
        'tag': dict(tag_counts),
        'days_distribution': days_distribution,
    }

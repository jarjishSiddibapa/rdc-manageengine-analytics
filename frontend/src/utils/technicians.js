// Options for the technician pickers. Once anyone is marked inactive the list is split into two groups, active first.
export function technicianOptions(technicians = []) {
  const option = t => ({ value: t.name, label: t.name });
  const active = technicians.filter(t => t.active !== false);
  if (active.length === technicians.length) return technicians.map(option);
  return [
    { label: 'Active', title: 'Active', options: active.map(option) },
    { label: 'Inactive', title: 'Inactive', options: technicians.filter(t => t.active === false).map(option) },
  ];
}

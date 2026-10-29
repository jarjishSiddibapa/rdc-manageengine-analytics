import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

// The search box that sits above a table; the page filters its own rows with matchesSearch().
export default function TableSearch({ value, onChange, placeholder = 'Search...', width = 260, style, label }) {
  return (
    <Input
      allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />} aria-label={label || placeholder.replace(/\.\.\.$/, '')}
      placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      style={{ width, maxWidth: '100%', ...style }}
    />
  );
}

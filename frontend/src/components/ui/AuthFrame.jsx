import { BarChartOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import { useAppConfig } from '../../context/AppConfig';
import BrandMark from './BrandMark';

// The page around every screen shown before sign-in (sign in, forgot password, choose a new password).
export default function AuthFrame({ children }) {
  const { config } = useAppConfig();
  return (
    <div className="login">
      <div className="login-art">
        <div className="brand" style={{ padding: 0, position: 'relative', zIndex: 1 }}>
          <BrandMark size={42} />
          <div className="brand-name">{config.app_name}<small>{config.org_name ? `${config.org_name} · ${config.login_subtitle}` : config.login_subtitle}</small></div>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2>{config.login_headline}</h2>
          <p>{config.login_blurb}</p>
          <div className="login-points">
            <div><BarChartOutlined /><span>Team dashboard and a complete page for each technician</span></div>
            <div><TeamOutlined /><span>Compare people fairly, against the team and over time</span></div>
            <div><SafetyCertificateOutlined /><span>Read-only on ManageEngine. Your own accounts and roles.</span></div>
          </div>
        </div>
        <div style={{ color: '#9aa0d4', fontSize: 12, position: 'relative', zIndex: 1 }}>{config.login_footer}</div>
      </div>
      <main className="login-form-wrap">
        <div className="login-form">
          <div className="login-mobile-brand"><BrandMark size={40} /><b>{config.app_name}</b></div>
          {children}
        </div>
      </main>
    </div>
  );
}

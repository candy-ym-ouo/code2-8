import { formatHour } from '../utils.js';

export default function DispatchConfirmDialog({ open, preview, loadedCount, unassignedCount, busy, onCancel, onConfirm }) {
  if (!open) return null;

  const projection = preview?.projection;
  const routes = preview?.routes ?? [];
  const warnings = preview?.warnings ?? [];

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="report-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dispatch-title">
        <div className="report-header">
          <div>
            <p className="eyebrow">出港前最终确认</p>
            <h2 id="confirm-dispatch-title">确认执行当日调度？</h2>
          </div>
          <span className={`report-reputation ${(projection?.reputationDelta || 0) >= 0 ? 'positive' : 'negative'}`}>
            信誉 {(projection?.reputationDelta || 0) >= 0 ? '+' : ''}{projection?.reputationDelta || 0}
          </span>
        </div>

        <div className="report-stats">
          <div><b>{routes.length}</b><span>出港航线</span></div>
          <div><b>{loadedCount}</b><span>装载邮件</span></div>
          <div><b>{unassignedCount}</b><span>未安排</span></div>
          <div>
            <b className={(projection?.creditsDelta || 0) >= 0 ? 'positive' : 'negative'}>
              {(projection?.creditsDelta || 0) >= 0 ? '+' : ''}{projection?.creditsDelta || 0}
            </b>
            <span>预计邮资</span>
          </div>
        </div>

        <div className="report-scroll">
          <div className="report-section">
            <h3>出港航线</h3>
            {routes.length === 0 && <p className="report-empty">今日没有出港航班，所有待处理邮件都会积压。</p>}
            {routes.map((route) => (
              <div className="report-route" key={route.courierId}>
                <div className="report-route-title">
                  <strong>{route.courierName}</strong>
                  <span>
                    {route.letterCount} 封 · {route.totalWeight}/{route.capacity} kg · {formatHour(route.startHour)} → {formatHour(route.endHour)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {warnings.length > 0 && (
            <div className="report-section report-warning">
              <h3>风险提示</h3>
              {warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}

          <p className="confirm-note">确认后立即结算当日信誉、邮资与岛屿关系；结算前可随时返回调整方案。</p>
        </div>

        <div className="report-footer">
          <div><span>确认前不会结算</span></div>
          <div className="confirm-actions">
            <button type="button" className="confirm-cancel" onClick={onCancel} disabled={busy}>返回调整</button>
            <button type="button" onClick={onConfirm} disabled={busy}>
              {busy ? '航线结算中...' : '确认结算'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

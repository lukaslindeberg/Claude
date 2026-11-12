import { useState } from 'react';
import { Segmented } from '../ui';
import { History } from './History';
import { Stats } from './Stats';

type Tab = 'history' | 'stats';

/** Your games: the match list and the statistics over them, as two views of one page. */
export function Matches() {
  const [tab, setTab] = useState<Tab>(() => (window.location.hash === '#stats' ? 'stats' : 'history'));
  const tabs = (
    <Segmented<Tab>
      value={tab}
      onChange={setTab}
      options={[
        { value: 'history', label: 'History' },
        { value: 'stats', label: 'Stats' },
      ]}
    />
  );
  return tab === 'history' ? <History tabs={tabs} /> : <Stats tabs={tabs} />;
}

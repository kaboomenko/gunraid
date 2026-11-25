'use client';

import { Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { CaseCard } from '@/components/ui/case-card';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount, GemIcon } from '@/components/ui/gem';
import { Field, Input } from '@/components/ui/input';
import { ItemCard } from '@/components/ui/item-card';
import { Modal } from '@/components/ui/modal';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

const SWATCHES = [
  ['bg', '#121117'],
  ['surface-1', '#15151B'],
  ['surface-2', '#1B1B22'],
  ['surface-3', '#24242E'],
  ['accent', '#C6FF00'],
  ['danger', '#FF3D5E'],
] as const;

const RARITIES = ['#B0C3D9', '#5E98D9', '#4B69FF', '#8847FF', '#D32CE6', '#EB4B4B', '#E4AE39'];

export function Showcase() {
  const t = useTranslations('showcase');
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(false);
  const [selected, setSelected] = useState(1);
  const [target] = useState(() => Date.now() + 1000 * 60 * 42);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display-oblique text-4xl font-extrabold uppercase">{t('title')}</h1>
        <p className="text-muted">{t('lead')}</p>
      </div>

      <section>
        <SectionTitle>{t('colors')}</SectionTitle>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {SWATCHES.map(([name, hex]) => (
            <div key={name} className="cut cut-sm overflow-hidden">
              <div className="h-16" style={{ background: hex }} />
              <div className="px-2 py-1.5 text-[11px] text-muted">
                {name}
                <br />
                {hex}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>{t('typography')}</SectionTitle>
        <div className="space-y-2">
          <div className="font-display-oblique text-3xl font-extrabold uppercase">
            {t('headline')}
          </div>
          <p className="max-w-xl text-muted">{t('body')}</p>
        </div>
      </section>

      <section>
        <SectionTitle>{t('buttons')}</SectionTitle>
        <div className="flex flex-wrap gap-3">
          <Button>{t('primary')}</Button>
          <Button variant="secondary">{t('secondary')}</Button>
          <Button variant="outline">{t('outline')}</Button>
          <Button variant="ghost">{t('ghost')}</Button>
          <Button variant="danger">{t('danger')}</Button>
          <Button loading>{t('loading')}</Button>
          <Button disabled>{t('disabled')}</Button>
          <Button size="sm">{t('primary')}</Button>
          <Button size="lg">{t('primary')}</Button>
        </div>
      </section>

      <section>
        <SectionTitle>{t('gems')}</SectionTitle>
        <div className="flex flex-wrap items-center gap-6">
          <GemIcon size={48} />
          <GemAmount value={5} size="xs" />
          <GemAmount value={1234} size="sm" />
          <GemAmount value={98765} size="md" />
          <GemAmount value={1250000} size="lg" />
          <GemAmount value={1250000} size="lg" compact />
          <GemAmount value={250} size="md" signed className="text-accent" />
          <GemAmount value={-250} size="md" className="text-danger" />
        </div>
      </section>

      <section>
        <SectionTitle>{t('cards')}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {RARITIES.map((c, i) => (
            <ItemCard
              key={c}
              name={t('demoItem')}
              skin={`${t('demoItem')} #${i + 1}`}
              rarityColor={c}
              price={(i + 1) * 1375}
              selected={selected === i}
              onClick={() => setSelected(i)}
              badges={i === 2 ? <Badge tone="warning">ST</Badge> : undefined}
            />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <CaseCard
              key={i}
              name={`${t('demoCase')} ${i + 1}`}
              price={(i + 1) * 249}
              accentColor={RARITIES[i + 2]}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>{t('forms')}</SectionTitle>
        <Card className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label={t('input')} hint={t('inputPlaceholder')} htmlFor="demo-input">
            <Input id="demo-input" placeholder={t('inputPlaceholder')} />
          </Field>
          <div className="space-y-4">
            <Checkbox
              id="demo-check"
              checked={checked}
              onCheckedChange={setChecked}
              label={t('checkbox')}
            />
            <div className="flex items-center gap-3">
              <Switch id="demo-switch" checked={on} onCheckedChange={setOn} label={t('switch')} />
              <span className="text-sm text-muted">{t('switch')}</span>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>{t('badges')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Badge>{t('badges')}</Badge>
            <Badge tone="accent">{t('badges')}</Badge>
            <Badge tone="soft">{t('badges')}</Badge>
            <Badge tone="danger">{t('badges')}</Badge>
            <Badge tone="warning">{t('badges')}</Badge>
            <Badge tone="info">{t('badges')}</Badge>
            <Badge color="#D32CE6">{t('badges')}</Badge>
          </div>
        </div>
        <div>
          <SectionTitle>{t('progress')}</SectionTitle>
          <Progress value={62} />
          <div className="mt-4 flex items-center gap-3 text-sm text-muted">
            {t('countdown')}:{' '}
            <Countdown to={target} className="font-display text-lg text-text tabular" />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>{t('tabs')}</SectionTitle>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">{t('tabA')}</TabsTrigger>
              <TabsTrigger value="b">{t('tabB')}</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="text-muted">
              {t('tabAText')}
            </TabsContent>
            <TabsContent value="b" className="text-muted">
              {t('tabBText')}
            </TabsContent>
          </Tabs>
        </div>
        <div>
          <SectionTitle>{t('modal')}</SectionTitle>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setOpen(true)}>
              {t('openModal')}
            </Button>
            <Button variant="secondary" onClick={() => toast.success(t('toastText'))}>
              {t('toast')}
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>{t('skeleton')}</SectionTitle>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </div>
        <div>
          <SectionTitle>{t('empty')}</SectionTitle>
          <EmptyState icon={<Package size={32} />} text={t('empty')} />
        </div>
      </section>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('modalTitle')}
        footer={
          <div className="flex gap-3">
            <Button block onClick={() => setOpen(false)}>
              {t('primary')}
            </Button>
            <Button block variant="secondary" onClick={() => setOpen(false)}>
              {t('secondary')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">{t('modalText')}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <ItemCard name={t('demoItem')} rarityColor={RARITIES[5] as string} price={4999} />
          <ItemCard name={t('demoItem')} rarityColor={RARITIES[6] as string} price={129900} />
        </div>
      </Modal>
    </div>
  );
}

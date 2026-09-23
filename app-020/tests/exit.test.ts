/**
 * 安全出口数量回归用例（依据 fire-evacuation-map.md 第 84 条）：
 * required = (楼层总面积 > exitMinAreaM2 或 估算人数 > exitMaxOccupants) ? 2 : 1；
 * 人数未填时按用途密度（㎡/人）由面积估算：办公 10、商业 3、仓库 50、病房 8、走道 0、其他 20。
 */
import { describe, it, expect } from 'vitest';
import { mkRoom, rect, mkFloor, ruleWith, validateFloor, DEFAULT_RULES } from './helpers';

type Fac = { kind: 'exit' | 'extinguisher'; x: number; y: number };

/** 房间中部一个灭火器保证覆盖不报警；出口点按传入给（开敞布局，出口在房内即连通） */
function openFloor(w: number, h: number, usage: Parameters<typeof mkRoom>[1], exitXs: number[], occupants?: number) {
  const facs: Fac[] = [
    ...exitXs.map((x): Fac => ({ kind: 'exit', x, y: h / 2 })),
    { kind: 'extinguisher', x: w / 2, y: h / 2 },
  ];
  return mkFloor([mkRoom('房', usage, rect(0, 0, w, h), occupants)], facs);
}

function exitItem(r: ReturnType<typeof validateFloor>) {
  return r.items.find((i) => i.type === 'EXIT_COUNT');
}

describe('安全出口数量', () => {
  it('E1 面积超限（300㎡>200）即需 2 个：0 出口报缺 2 个（空仓库只放灭火器）', () => {
    const { floor } = openFloor(20, 15, 'storage', []); // 仓库 50㎡/人，300㎡ 仅估 6 人
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.required).toBe(2);
    const it = exitItem(r);
    expect(it).toBeDefined();
    expect(it!.value).toBe(0);
    expect(it!.limit).toBe(2);
    expect(it!.message).toContain('面积 300㎡ 超过限值 200㎡');
  });

  it('E2 面积未超但人数超（36㎡/60人>50）需 2 个：1 个出口判不足', () => {
    const { floor } = openFloor(6, 6, 'office', [0.5], 60);
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.required).toBe(2);
    expect(exitItem(r)?.message).toContain('人数约 60 超过限值 50');
  });

  it('E3 小面积且人数未超：36㎡/40 人 1 个出口即够', () => {
    const { floor } = openFloor(6, 6, 'office', [3], 40);
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.required).toBe(1);
    expect(exitItem(r)).toBeUndefined();
  });

  it('E4 人数未填按用途密度×面积估算：180㎡商业估 60 人（180/3），面积虽<200 仍需 2 个', () => {
    const { floor } = openFloor(15, 12, 'retail', [0.5]);
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.required).toBe(2);
    expect(exitItem(r)?.message).toContain('人数约 60 超过限值 50');
  });

  it('E5 密度随面积变化：同一办公房间 120㎡估12人（1个够）→ 156㎡估16人仍够；改宽到 520㎡估52人（需2个）', () => {
    // 面积始终低于 200㎡ 限值时，结论只由「密度 × 面积」的估算人数驱动
    const r1 = validateFloor(openFloor(20, 6, 'office', [10]).floor, DEFAULT_RULES.office);
    expect(r1.exits.required).toBe(1);
    expect(exitItem(r1)).toBeUndefined();
    const r2 = validateFloor(openFloor(26, 6, 'office', [3]).floor, DEFAULT_RULES.office);
    expect(r2.exits.required).toBe(1); // 156㎡ 估 16 人，仍未超 50
    expect(exitItem(r2)).toBeUndefined();
    const r3 = validateFloor(openFloor(52, 10, 'office', [0.5]).floor, DEFAULT_RULES.office);
    expect(r3.exits.required).toBe(2); // 520㎡：面积、人数均超限
    expect(exitItem(r3)?.message).toContain('人数约 52 超过限值 50');
  });

  it('E5b 面积不变只改长（20m→26m 宽6m 商业，3㎡/人）：40人够→52人需2个，结论跟随面积变', () => {
    const r1 = validateFloor(openFloor(20, 6, 'retail', [10]).floor, DEFAULT_RULES.office);
    expect(r1.exits.required).toBe(1); // 120㎡ 估 40 人
    const r2 = validateFloor(openFloor(26, 6, 'retail', [0.5]).floor, DEFAULT_RULES.office);
    expect(r2.exits.required).toBe(2); // 156㎡ 估 52 人，面积仍 <200，纯人数触发
    expect(exitItem(r2)?.message).toContain('人数约 52 超过限值 50');
  });

  it('E6 仓库密度稀疏（50㎡/人）：180㎡估4人且面积未超 → 1 个够，不因密度常量恒为50误判', () => {
    const { floor } = openFloor(15, 12, 'storage', [7.5]);
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.required).toBe(1);
    expect(exitItem(r)).toBeUndefined();
  });

  it('E7 走道不计停留人数：41m 走道（密度0）双出口仍只需按面积判定', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
      { kind: 'extinguisher', x: 20.5, y: 1 },
    ]);
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.required).toBe(1); // 82㎡、0 人
    expect(exitItem(r)).toBeUndefined();
  });

  it('E8 满足数量即通过：300㎡空仓库布置 2 个出口无 EXIT_COUNT 错误', () => {
    const { floor } = openFloor(20, 15, 'storage', [0.5, 19.5]);
    const r = validateFloor(floor, DEFAULT_RULES.office);
    expect(r.exits.present).toBe(2);
    expect(r.exits.required).toBe(2);
    expect(exitItem(r)).toBeUndefined();
  });

  it('E9 规则可配：调大人数限值后同样 36㎡/60 人只需 1 个出口', () => {
    const { floor } = openFloor(6, 6, 'office', [3], 60);
    const relaxed = ruleWith(DEFAULT_RULES.office, { exitMaxOccupants: 100 });
    const r = validateFloor(floor, relaxed);
    expect(r.exits.required).toBe(1);
    expect(exitItem(r)).toBeUndefined();
  });
});

/**
 * 安全出口数量判定回归（规范见 fire-evacuation-map.md 第 84 条）：
 * 面积 > exitMinAreaM2 或 估算人数 > exitMaxOccupants 任一成立即需 2 个出口；
 * 人数未填时按「用途密度 × 房间面积」估算，改面积结论必须跟着变。
 */
import { describe, it, expect } from 'vitest';
import { mkRoom, rect, mkFloor, validateFloor } from './helpers';

type ValidationResult = ReturnType<typeof validateFloor>;
const exitCountItem = (r: ValidationResult) => r.items.find((i) => i.type === 'EXIT_COUNT');

describe('安全出口数量：面积或人数任一超限即需 2 个', () => {
  it('E1 又大又空的仓库（900㎡、人数未填、仅 1 个灭火器）面积超限 → 需 2 个出口', () => {
    // 仓库密度 50㎡/人 → 估算 18 人，不超 50；但 900㎡ > 200㎡ 限值
    const { floor, rules } = mkFloor([mkRoom('仓库', 'storage', rect(0, 0, 30, 30))], [
      { kind: 'exit', x: 1, y: 1 },
      { kind: 'extinguisher', x: 15, y: 15 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exits).toEqual({ present: 1, required: 2 });
    const item = exitCountItem(r);
    expect(item).toBeDefined();
    expect(item!.severity).toBe('error');
    expect(item!.message).toContain('面积超限值 200㎡');
    expect(item!.message).toContain('人数约 18');
  });

  it('E2 小办公室（100㎡）填 60 人：面积不超但人数超限 → 需 2 个出口', () => {
    const { floor, rules } = mkFloor([mkRoom('办公室', 'office', rect(0, 0, 10, 10), 60)], [
      { kind: 'exit', x: 1, y: 1 },
      { kind: 'extinguisher', x: 5, y: 5 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exits).toEqual({ present: 1, required: 2 });
    const item = exitCountItem(r);
    expect(item).toBeDefined();
    expect(item!.message).toContain('人数超限值 50 人');
    expect(item!.message).not.toContain('面积超限');
  });

  it('E3 人数严格大于限值才触发：50 人需 1 个，51 人需 2 个', () => {
    const mk = (occ: number): ValidationResult => {
      const { floor, rules } = mkFloor([mkRoom('办公室', 'office', rect(0, 0, 10, 10), occ)], [
        { kind: 'exit', x: 1, y: 1 },
        { kind: 'extinguisher', x: 5, y: 5 },
      ]);
      return validateFloor(floor, rules);
    };
    expect(mk(50).exits.required).toBe(1);
    expect(mk(51).exits.required).toBe(2);
  });

  it('E4 人数未填时估算随面积走（商业 3㎡/人，面积均 ≤200㎡）：60㎡→20人需1个，180㎡→60人需2个', () => {
    const small = mkFloor([mkRoom('小店', 'retail', rect(0, 0, 10, 6))], [
      { kind: 'exit', x: 1, y: 1 },
    ]);
    const r1 = validateFloor(small.floor, small.rules);
    expect(r1.exits.required).toBe(1);
    expect(exitCountItem(r1)).toBeUndefined();

    const large = mkFloor([mkRoom('大店', 'retail', rect(0, 0, 18, 10))], [
      { kind: 'exit', x: 1, y: 1 },
    ]);
    const r2 = validateFloor(large.floor, large.rules);
    expect(r2.exits.required).toBe(2);
    expect(exitCountItem(r2)!.message).toContain('人数约 60');
  });

  it('E5 同一房间改大改小结论联动：商业 150㎡→50人需1个，153㎡→51人需2个', () => {
    const mk = (w: number): ValidationResult => {
      const { floor, rules } = mkFloor([mkRoom('商铺', 'retail', rect(0, 0, w, 10))], [
        { kind: 'exit', x: 1, y: 1 },
      ]);
      return validateFloor(floor, rules);
    };
    expect(mk(15).exits.required).toBe(1);
    expect(mk(15.3).exits.required).toBe(2);
  });

  it('E6 估算 = 面积 ÷ 密度并向上取整（办公100㎡→10人、办公25㎡→3人、仓库180㎡→4人）', () => {
    const mk = (usage: 'office' | 'storage', w: number, h: number): ValidationResult => {
      const { floor, rules } = mkFloor([mkRoom('房', usage, rect(0, 0, w, h))], [
        { kind: 'exit', x: 1, y: 1 },
      ]);
      return validateFloor(floor, rules);
    };
    // 办公 100㎡ → 10 人，面积人数均不超 → 1 个出口
    expect(mk('office', 10, 10).exits.required).toBe(1);
    // 办公 25㎡ → ceil(2.5)=3 人
    expect(mk('office', 5, 5).exits.required).toBe(1);
    // 仓库 180㎡（≤200）→ ceil(180/50)=4 人 → 仍只需 1 个出口
    expect(mk('storage', 18, 10).exits.required).toBe(1);
    // 仓库 201㎡ → 面积超限 → 2 个
    expect(mk('storage', 20.1, 10).exits.required).toBe(2);
  });

  it('E7 已填人数优先于密度估算：180㎡商业本估算 60 人，填 10 人 → 需 1 个出口', () => {
    const { floor, rules } = mkFloor([mkRoom('大店', 'retail', rect(0, 0, 18, 10), 10)], [
      { kind: 'exit', x: 1, y: 1 },
      { kind: 'extinguisher', x: 9, y: 5 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exits.required).toBe(1);
    expect(exitCountItem(r)).toBeUndefined();
  });

  it('E8 面积、人数均不超且 1 个出口：整体校验通过', () => {
    const { floor, rules } = mkFloor([mkRoom('办公室', 'office', rect(0, 0, 10, 10))], [
      { kind: 'exit', x: 1, y: 1 },
      { kind: 'extinguisher', x: 5, y: 5 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exits).toEqual({ present: 1, required: 1 });
    expect(exitCountItem(r)).toBeUndefined();
    expect(r.pass).toBe(true);
  });
});

import {describe,it,expect} from "vitest";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
describe("Explicit historical calendars, no present-time substitute",()=>{
  it.each([
    {id:42,bits:"111011",changed_bits:"111001",month:"乙未",day:"己酉",moving:[5],self:1},
    {id:43,bits:"011110",changed_bits:"010001",month:"乙未",day:"庚戌",moving:[3,4,5,6],self:4},
  ])("decorates case $id from bits and explicit month/day only",sample=>{
    const r=spawnSync(resolve("fortune_module4/.venv/bin/python"),["scripts/historical-blind-core.py"],{input:JSON.stringify(sample),encoding:"utf8"});
    expect(r.status,r.stderr).toBe(0);const c=JSON.parse(r.stdout);
    expect(c.calendar.year_ganzhi).toBeNull();expect(c.calendar.hour_ganzhi).toBeNull();expect(c.calendar.calendar_time).toBeNull();
    expect(c.calendar.month_ganzhi).toBe(sample.month);expect(c.calendar.day_ganzhi).toBe(sample.day);
    expect(c.calendar.empty_branches).toEqual(["寅","卯"]);
    expect(c.main_lines.filter((l:{moving:boolean})=>l.moving).map((l:{position:number})=>l.position)).toEqual(sample.moving);
    expect(c.palace.self_position).toBe(sample.self);
    if(sample.id===42){expect(c.main_lines[4].ganzhi).toBe("辛巳");expect(c.hidden_lines[0].kin).toBe("officials");}
    else {expect(c.main_lines[3].kin).toBe("parents");expect(c.main_lines[3].branch).toBe("亥");expect(c.palace.stage).toBe("游魂");}
  });
});

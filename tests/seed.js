module.exports = function seed() {
  const people = ['arvind','abhinandh','sai'];
  const base = { arvind: 78.4, abhinandh: 71.2, sai: 84.9 };
  const habits = ['move','water','sleep','food','clear'];
  const workouts = ['Gym','Run','Walk','Cycle','Sports','Yoga','Rest'];
  const recs = {};
  const today = new Date();
  let n = 7;
  const rnd = () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
  for (const p of people) {
    for (let i = 44; i >= 1; i--) {           // leave today blank for the test to fill
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = `entry:${p}:${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (rnd() < 0.18) continue;
      recs[key] = { v: {
        steps: Math.round(4000 + rnd() * 11000),
        weight: Math.round((base[p] - (44 - i) * 0.02 + (rnd() - 0.5) * 0.6) * 10) / 10,
        active: Math.round(rnd() * 80),
        workout: workouts[Math.floor(rnd() * workouts.length)],
        habits: habits.filter(() => rnd() < 0.55),
        note: rnd() < 0.2 ? 'Legs were heavy but got it done.' : ''
      }, t: Date.now() - i * 86400000 };
    }
  }
  return { records: recs };
};

function limiter(maximum) {
  let active = 0;
  const waiting = [];
  const run = () => {
    while (active < maximum && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active -= 1; run(); });
    }
  };
  return task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); run(); });
}

async function publishMetadataPair(names, operations) {
  const previous = new Map();
  for (const name of names) {
    const value = await operations.readPrevious(name);
    if (value !== null) previous.set(name, value);
  }
  const published = [];
  try {
    for (const name of names) {
      await operations.publishAndVerify(name);
      published.push(name);
    }
  } catch (error) {
    const rollback = await Promise.allSettled(published.map(name => previous.has(name)
      ? operations.restore(name, previous.get(name))
      : operations.remove(name)));
    const failed = rollback.filter(result => result.status === 'rejected');
    if (failed.length) throw new AggregateError([error, ...failed.map(result => result.reason)], 'Metadata publication and rollback both failed.');
    throw new Error(`Metadata publication rolled back after failure: ${error.message}`);
  }
}

export { limiter, publishMetadataPair };

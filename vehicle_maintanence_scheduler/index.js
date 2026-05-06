const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const BASE_URL = 'http://20.207.122.201/evaluation-service';

function solveKnapsack(capacity, tasks) {
  const n = tasks.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = tasks[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        const withTask = dp[i - 1][w - Duration] + Impact;
        if (withTask > dp[i][w]) dp[i][w] = withTask;
      }
    }
  }

  const selected = [];
  let rem = capacity;
  for (let i = n; i >= 1; i--) {
    if (dp[i][rem] !== dp[i - 1][rem]) {
      selected.push(tasks[i - 1].TaskID);
      rem -= tasks[i - 1].Duration;
    }
  }

  return {
    totalImpact: dp[n][capacity],
    selectedTaskIDs: selected.reverse()
  };
}

app.get('/schedule', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const headers = { Authorization: authHeader };

  try {
    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers }),
      axios.get(`${BASE_URL}/vehicles`, { headers })
    ]);

    const depots = depotsRes.data.depots;
    const vehicles = vehiclesRes.data.vehicles;

    const schedule = depots.map((depot) => {
      const result = solveKnapsack(depot.MechanicHours, vehicles);

      const hoursUsed = result.selectedTaskIDs.reduce((sum, id) => {
        const task = vehicles.find((v) => v.TaskID === id);
        return sum + (task ? task.Duration : 0);
      }, 0);

      return {
        depotID: depot.ID,
        mechanicHoursBudget: depot.MechanicHours,
        hoursUsed: hoursUsed,
        totalImpactAchieved: result.totalImpact,
        selectedTasks: result.selectedTaskIDs
      };
    });

    return res.status(200).json({
      totalDepots: depots.length,
      totalVehicles: vehicles.length,
      schedule
    });

  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({ error: err.response.data });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'vehicle-scheduling' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vehicle Scheduling service running on port ${PORT}`);
});




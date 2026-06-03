const statusList = document.getElementById('status-list');
const lastUpdated = document.getElementById('last-updated');
const refreshButton = document.getElementById('refresh-button');
const eventsList = document.getElementById('events-list');

async function fetchStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    statusList.innerHTML = '';

    data.results.forEach(service => {
      const item = document.createElement('div');
      item.className = 'status-item';
      item.innerHTML = `
        <div class="service-name">${service.name}</div>
        <div class="service-state ${service.healthy ? 'healthy' : 'unhealthy'}">${service.healthy ? 'Healthy' : 'Unhealthy'}</div>
        <div class="service-details">${service.details}</div>
      `;
      statusList.appendChild(item);
    });

    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    return data;
  } catch (error) {
    statusList.innerHTML = `<div class="service-item unhealthy">Unable to fetch status: ${error.message}</div>`;
    return { refreshSeconds: 5 };
  }
}

refreshButton.addEventListener('click', fetchStatus);
fetchStatus().then(data => {
  const interval = (data?.refreshSeconds || 5) * 1000;
  setInterval(fetchStatus, interval);
  
  // realtime socket.io events
  const socket = io();
  socket.on('connect', () => {
    console.log('connected to visualizer socket');
  });
  socket.on('event', data => {
    const el = document.createElement('div');
    el.className = 'event-item';
    el.textContent = `${new Date().toLocaleTimeString()} ${data.type || data.path || 'event'}: ${JSON.stringify(data)}`;
    if (eventsList.firstChild && eventsList.firstChild.textContent === 'No events yet') eventsList.innerHTML = '';
    eventsList.prepend(el);
  });
});

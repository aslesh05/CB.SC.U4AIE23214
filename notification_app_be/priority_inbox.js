const axios = require('axios');

class NotificationPriority {
    constructor() {
        this.typeWeights = {
            'Result': 3,
            'Placement': 2,
            'Event': 1
        };
        this.recencyBonus = 100;
    }

    calculateScore(notification) {
        const notificationTime = new Date(notification.Timestamp);
        const now = new Date();
        const timeDiff = now - notificationTime;
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        let baseScore = this.typeWeights[notification.Type] || 0;

        if (hoursDiff < 24) {
            baseScore += this.recencyBonus / (timeDiff / 1000 + 1);
        }

        return baseScore;
    }
}

class PriorityInbox {
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
        this.priorityCalc = new NotificationPriority();
        this.top10 = [];
    }

    async fetchNotifications() {
        try {
            const response = await axios.get(this.apiUrl, { timeout: 10000 });
            return response.data.notifications || [];
        } catch (error) {
            console.error('Error fetching notifications:', error.message);
            return [];
        }
    }

    buildPriorityInbox(notifications) {
        const scored = notifications.map(notif => ({
            score: this.priorityCalc.calculateScore(notif),
            notification: notif
        }));

        scored.sort((a, b) => b.score - a.score);

        this.top10 = scored.slice(0, 10).map((item, index) => ({
            rank: index + 1,
            id: item.notification.ID,
            type: item.notification.Type,
            message: item.notification.Message,
            timestamp: item.notification.Timestamp,
            priorityScore: item.score.toFixed(2)
        }));

        return this.top10;
    }

    displayResults() {
        console.log('\n' + '='.repeat(90));
        console.log('TOP 10 PRIORITY NOTIFICATIONS - INBOX');
        console.log('='.repeat(90));

        this.top10.forEach(notif => {
            console.log(`\n${notif.rank}. [${notif.type.toUpperCase()}] | Priority: ${notif.priorityScore}`);
            console.log(`   ID: ${notif.id}`);
            console.log(`   Message: ${notif.message}`);
            console.log(`   Time: ${notif.timestamp}`);
        });

        console.log('\n' + '='.repeat(90));
        console.log(`Total Top 10 Notifications: ${this.top10.length}`);
        console.log('='.repeat(90) + '\n');
    }
}

async function main() {
    const apiUrl = 'http://20.207.122.201/evaluation-service/notifications';
    const inbox = new PriorityInbox(apiUrl);

    console.log('Fetching notifications from API...');
    const notifications = await inbox.fetchNotifications();

    if (notifications.length > 0) {
        console.log(`Retrieved ${notifications.length} notifications\n`);
        inbox.buildPriorityInbox(notifications);
        inbox.displayResults();
    } else {
        console.log('No notifications retrieved');
    }
}
main();

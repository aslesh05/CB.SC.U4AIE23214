import heapq
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Tuple
import time

class NotificationPriority:
    def __init__(self):
        self.type_weights = {
            'placement': 3,
            'result': 2,
            'event': 1
        }
        self.recency_bonus = 100

    def calculate_score(self, notification: Dict) -> Tuple[float, str]:
        notification_time = datetime.fromisoformat(
            notification['Timestamp'].replace('Z', '+00:00')
        )
        time_diff = datetime.now(notification_time.tzinfo) - notification_time
        
        base_score = self.type_weights.get(notification['Type'], 0)
        
        if time_diff < timedelta(hours=24):
            base_score += self.recency_bonus / (time_diff.total_seconds() + 1)
        
        return base_score, notification['ID']

class PriorityInbox:
    def __init__(self, api_url: str):
        self.api_url = api_url
        self.priority_calc = NotificationPriority()
        self.top_10_heap = []
        self.top_10_set = set()

    def fetch_notifications(self) -> List[Dict]:
        try:
            response = requests.get(self.api_url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get('notifications', [])
        except Exception as e:
            print(f"Error fetching notifications: {e}")
        return []

    def build_priority_inbox(self, notifications: List[Dict]) -> List[Dict]:
        self.top_10_heap = []
        self.top_10_set = set()
        
        scored_notifications = []
        for notif in notifications:
            score, notif_id = self.priority_calc.calculate_score(notif)
            scored_notifications.append((-score, notif_id, notif))
        
        scored_notifications.sort()
        
        for score, notif_id, notif in scored_notifications[:10]:
            self.top_10_heap.append((score, notif_id, notif))
            self.top_10_set.add(notif_id)
        
        result = []
        for score, notif_id, notif in self.top_10_heap:
            result.append({
                'ID': notif['ID'],
                'Type': notif['Type'],
                'Message': notif['Message'],
                'Timestamp': notif['Timestamp'],
                'Priority': -score
            })
        
        return result

    def add_notification(self, notification: Dict) -> List[Dict]:
        score, notif_id = self.priority_calc.calculate_score(notification)
        
        if len(self.top_10_heap) < 10:
            self.top_10_heap.append((-score, notif_id, notification))
            self.top_10_set.add(notif_id)
            heapq.heapify(self.top_10_heap)
        elif -score > self.top_10_heap[0][0]:
            removed = heapq.heappop(self.top_10_heap)
            self.top_10_set.remove(removed[1])
            heapq.heappush(self.top_10_heap, (-score, notif_id, notification))
            self.top_10_set.add(notif_id)
        
        result = []
        for score, notif_id, notif in sorted(self.top_10_heap, reverse=True):
            result.append({
                'ID': notif['ID'],
                'Type': notif['Type'],
                'Message': notif['Message'],
                'Timestamp': notif['Timestamp'],
                'Priority': -score
            })
        
        return result

    def get_top_10(self) -> List[Dict]:
        result = []
        for score, notif_id, notif in sorted(self.top_10_heap, reverse=True):
            result.append({
                'ID': notif['ID'],
                'Type': notif['Type'],
                'Message': notif['Message'],
                'Timestamp': notif['Timestamp'],
                'Priority': -score
            })
        return result

def main():
    api_url = "http://20.207.122.201/evaluation-service/notifications"
    
    inbox = PriorityInbox(api_url)
    
    print("Fetching notifications from API...")
    notifications = inbox.fetch_notifications()
    
    if notifications:
        print(f"Retrieved {len(notifications)} notifications")
        print("\nBuilding Priority Inbox...\n")
        
        top_10 = inbox.build_priority_inbox(notifications)
        
        print("=" * 80)
        print("TOP 10 PRIORITY NOTIFICATIONS")
        print("=" * 80)
        
        for idx, notif in enumerate(top_10, 1):
            print(f"\n{idx}. [{notif['Type'].upper()}] - Priority Score: {notif['Priority']:.2f}")
            print(f"   ID: {notif['ID']}")
            print(f"   Message: {notif['Message']}")
            print(f"   Time: {notif['Timestamp']}")
        
        print("\n" + "=" * 80)
        print(f"Total Notifications: {len(notifications)}")
        print(f"Priority Inbox Size: {len(top_10)}")
        print("=" * 80)
    else:
        print("No notifications retrieved from API")

if __name__ == "__main__":
    main()

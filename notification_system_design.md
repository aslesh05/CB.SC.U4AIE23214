# Stage 1

## Core Actions
- Fetch unread notifications
- Mark notification as read
- Delete notification
- Create notification

## REST API Endpoints

### GET /api/notifications
Fetch all notifications for logged-in user

**Request Headers:**
```
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "placement|result|event",
      "message": "string",
      "timestamp": "ISO8601",
      "isRead": boolean
    }
  ]
}
```

### GET /api/notifications/{id}
Fetch single notification

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "placement|result|event",
    "message": "string",
    "timestamp": "ISO8601",
    "isRead": boolean
  }
}
```

### PUT /api/notifications/{id}/read
Mark notification as read

**Request Body:**
```json
{
  "isRead": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "isRead": true
  }
}
```

### DELETE /api/notifications/{id}
Delete notification

**Response:**
```json
{
  "success": true,
  "message": "Notification deleted"
}
```

### POST /api/notifications/create
Create notification (internal use)

**Request Body:**
```json
{
  "studentId": "uuid",
  "type": "placement|result|event",
  "message": "string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "studentId": "uuid",
    "type": "placement",
    "message": "string",
    "timestamp": "ISO8601",
    "isRead": false
  }
}
```

## Real-time Notification Mechanism
Use WebSocket connection for pushing notifications to client:
- Client establishes WebSocket connection at `/api/notifications/subscribe`
- Server maintains open connections and pushes new notifications in real-time
- Fallback to polling (GET /api/notifications with query param `updatedSince`)

---

# Stage 2

## Database Choice: PostgreSQL

PostgreSQL chosen for:
- ACID compliance for reliable notifications
- JSON support for flexible notification types
- Advanced indexing capabilities
- Better for transactional consistency

## Database Schema

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  studentId UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('placement', 'result', 'event')),
  message TEXT NOT NULL,
  isRead BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notification_status (
  id UUID PRIMARY KEY,
  notificationId UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  emailSent BOOLEAN DEFAULT FALSE,
  appNotificationSent BOOLEAN DEFAULT FALSE,
  emailFailedAt TIMESTAMP,
  appFailedAt TIMESTAMP
);

CREATE INDEX idx_notifications_student_id ON notifications(studentId);
CREATE INDEX idx_notifications_is_read ON notifications(isRead);
CREATE INDEX idx_notifications_created_at ON notifications(createdAt);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_composite ON notifications(studentId, isRead, createdAt);
CREATE INDEX idx_notification_status_notification_id ON notification_status(notificationId);
```

## Scalability Issues & Solutions

### Issue 1: Growing Data Volume
**Problem**: 50M notifications causes slow queries
**Solution**: 
- Table partitioning by month/year on createdAt
- Archive old notifications (>6 months) to separate table
- Implement data retention policy

### Issue 2: High Read Load
**Solution**:
- Redis cache layer for unread counts
- Materialized views for frequently accessed data
- Read replicas for heavy queries

### Issue 3: Write Throughput
**Solution**:
- Batch inserts for notification creation
- Message queue (RabbitMQ/Kafka) for async processing
- Connection pooling

## SQL Queries

### Fetch unread notifications with pagination
```sql
SELECT id, type, message, timestamp, isRead 
FROM notifications 
WHERE studentId = $1 AND isRead = false 
ORDER BY createdAt DESC 
LIMIT 20 OFFSET $2;
```

### Count unread notifications
```sql
SELECT COUNT(*) as unreadCount 
FROM notifications 
WHERE studentId = $1 AND isRead = false;
```

### Mark as read
```sql
UPDATE notifications 
SET isRead = true, updatedAt = CURRENT_TIMESTAMP 
WHERE id = $1 AND studentId = $2;
```

### Bulk create notifications
```sql
INSERT INTO notifications (id, studentId, type, message, createdAt) 
VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP);
```

---

# Stage 3

## Query Analysis

**Original Query Issues:**
```sql
SELECT * FROM notifications 
WHERE studentID = 1042 AND isRead = false 
ORDER BY createdAt DESC;
```

Problems:
1. No index on (studentID, isRead, createdAt) - full table scan
2. SELECT * fetches unnecessary columns (only need id, message, timestamp, type)
3. No LIMIT - returns all unread notifications at once
4. Column name inconsistency: should be studentId

## Optimized Query

```sql
SELECT id, type, message, createdAt 
FROM notifications 
WHERE studentId = 1042 AND isRead = false 
ORDER BY createdAt DESC 
LIMIT 50;
```

## Query for Placement Notifications (Last 7 Days)

```sql
SELECT id, type, message, createdAt 
FROM notifications 
WHERE studentId = $1 
AND type = 'placement' 
AND createdAt >= NOW() - INTERVAL '7 days' 
ORDER BY createdAt DESC;
```

## Index Strategy

**Essential Indexes:**
```sql
CREATE INDEX idx_notifications_student_read_date 
ON notifications(studentId, isRead, createdAt DESC);

CREATE INDEX idx_notifications_type_date 
ON notifications(type, createdAt DESC);
```

**Why Not Index Every Column:**
- Storage overhead increases exponentially
- Write performance degrades (every INSERT needs index updates)
- Most indexes unused - wasted resources
- Maintenance complexity increases
- Better approach: Create selective indexes on frequently queried columns

## Likely Computation Cost

**Before Optimization**: O(n) full scan - 5M+ rows
**After Optimization**: O(log n) index scan + O(k log k) sorting where k=50 results

Estimated improvement: 1000x faster for this specific query

---

# Stage 4

## Performance Problems
- 50,000 students requesting notifications on every page load
- Database connection pool exhausted
- Query response time increases exponentially
- Out of memory errors

## Proposed Solutions

### Solution 1: Caching Layer
**Approach**: Redis cache for unread notification counts and recent notifications
**Tradeoffs**:
- Pro: Instant reads, reduces DB load by 80%
- Con: Cache invalidation complexity, potential stale data (5-10s TTL acceptable)

### Solution 2: Pagination
**Approach**: Load first 20 notifications, infinite scroll loads more
**Tradeoffs**:
- Pro: Reduced data transfer, faster initial load
- Con: Extra queries for pagination, user expects full list sometimes

### Solution 3: Background Processing
**Approach**: Fetch notifications asynchronously, show cached version
**Tradeoffs**:
- Pro: Non-blocking UI, better user experience
- Con: Shows potentially stale data, added complexity

### Solution 4: Database Optimization
**Approach**: Read replicas, connection pooling, query optimization
**Tradeoffs**:
- Pro: Scalable to millions of requests
- Con: Higher infrastructure cost, operational complexity

## Recommended Approach
**Combine Solutions 1 + 2 + 3**:
1. Cache unread counts in Redis (invalidate on new notification)
2. Paginate with 20 items per page
3. Fetch in background while showing cached version
4. Add CDN for API responses (if applicable)

---

# Stage 5

## Issues with Current Implementation
1. **No transaction**: If send_email succeeds but save_to_db fails, inconsistent state
2. **No retry logic**: Failures result in lost notifications
3. **No rollback**: Partial failures aren't handled
4. **Synchronous execution**: Blocks if any operation is slow
5. **No monitoring**: Can't track which students didn't receive notification

## Redesigned Approach

```
function notify_all(student_ids: array, message: string):
  notification_batch_id = generate_uuid()
  
  create_notifications_in_batch(student_ids, message, notification_batch_id)
  
  queue_email_jobs(student_ids, message, notification_batch_id)
  queue_app_notification_jobs(student_ids, message, notification_batch_id)
  
  return {
    batchId: notification_batch_id,
    status: "processing",
    totalStudents: student_ids.length
  }

function queue_email_jobs(student_ids, message, batch_id):
  for each chunk of 100 student_ids:
    push_to_queue({
      type: "send_email",
      students: chunk,
      message: message,
      batchId: batch_id,
      retryCount: 0,
      maxRetries: 3
    })

function queue_app_notification_jobs(student_ids, message, batch_id):
  for each chunk of 500 student_ids:
    push_to_queue({
      type: "push_app_notification",
      students: chunk,
      message: message,
      batchId: batch_id,
      retryCount: 0,
      maxRetries: 2
    })

async function process_email_queue_job(job):
  failed_students = []
  
  for each student in job.students:
    try:
      send_email(student, job.message)
      mark_email_sent(student, job.batchId)
    catch error:
      failed_students.append({
        studentId: student,
        error: error.message,
        timestamp: now()
      })
  
  if failed_students.length > 0:
    if job.retryCount < job.maxRetries:
      retry_job = clone(job)
      retry_job.retryCount += 1
      retry_job.students = [s.studentId for s in failed_students]
      push_to_queue(retry_job)
      delay_seconds = 2 ^ job.retryCount
      schedule_with_delay(retry_job, delay_seconds)
    else:
      log_permanent_failure(job.batchId, failed_students)
      alert_admin(failed_students)

async function process_app_notification_queue_job(job):
  failed_students = []
  
  for each student in job.students:
    try:
      push_to_app(student, job.message)
      mark_app_notification_sent(student, job.batchId)
    catch error:
      failed_students.append({
        studentId: student,
        error: error.message,
        timestamp: now()
      })
  
  if failed_students.length > 0:
    if job.retryCount < job.maxRetries:
      retry_job = clone(job)
      retry_job.retryCount += 1
      retry_job.students = [s.studentId for s in failed_students]
      schedule_with_delay(retry_job, 5)
      push_to_queue(retry_job)
    else:
      log_permanent_failure(job.batchId, failed_students)

function get_notification_batch_status(batch_id):
  return {
    batchId: batch_id,
    totalStudents: count_all_for_batch(batch_id),
    emailSent: count_email_sent(batch_id),
    emailFailed: count_email_failed(batch_id),
    appNotificationSent: count_app_sent(batch_id),
    appNotificationFailed: count_app_failed(batch_id),
    status: determine_status(batch_id)
  }
```

## Key Improvements
1. **Separation of concerns**: Email and app notifications decoupled
2. **Idempotency**: Storing notification_status table prevents duplicate sends
3. **Exponential backoff**: Retries with increasing delays
4. **Batch processing**: Handle chunked students (prevents resource exhaustion)
5. **Monitoring**: Track batch status and failures
6. **Async execution**: Non-blocking queue-based processing
7. **Partial failure handling**: Doesn't fail entire batch if some students unreachable

---

# Stage 6

## Approach
Priority Inbox implementation using in-memory heap structure with background refresh.

**Priority Scoring**: 
- Placement: weight 3
- Result: weight 2
- Event: weight 1
- Recency: bonus for notifications created in last 24 hours

**Algorithm**: 
Fetch all recent notifications, score them, maintain top 10 in min-heap.

**Maintenance of Top 10**: 
When new notification arrives, add to heap and pop minimum if size exceeds 10.

**Efficiency**: 
Heap operations O(log 10) = O(1) practically. Background refresh every 30 seconds.




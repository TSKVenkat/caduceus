# System Design Example: Building a URL Shortener Service

Let's apply the system design principles we learned from Caduceus to design a URL shortening service like Bitly.

## 1. Requirements Analysis

### Functional Requirements
1. Given a URL, generate a shorter alias (short link)
2. When a user accesses the short link, redirect to the original URL
3. Allow custom short links
4. Provide analytics (click count, etc.)

### Non-Functional Requirements
1. High availability
2. Low latency for redirections (<100ms)
3. Scalability to handle millions of URLs
4. Fault tolerance

## 2. High-Level Design

```
Client → Load Balancer → Web Servers → Database
                ↓
            Cache Layer
                ↓
           Analytics Service
```

## 3. API Design

### 3.1 Create Short URL
```
POST /api/shorten
{
  "url": "https://example.com/very/long/url",
  "customAlias": "mylink"  // optional
}

Response:
{
  "shortUrl": "https://short.ly/mylink"
}
```

### 3.2 Redirect
```
GET /{shortId}
301 Redirect to original URL
```

### 3.3 Analytics
```
GET /api/analytics/{shortId}
{
  "clicks": 1234,
  "createdAt": "2023-01-01T00:00:00Z"
}
```

## 4. Data Model

### URLs Table
```sql
CREATE TABLE urls (
  id VARCHAR(10) PRIMARY KEY,  -- short ID
  original_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  user_id VARCHAR(36) NULL
);
```

### Analytics Table
```sql
CREATE TABLE analytics (
  url_id VARCHAR(10) REFERENCES urls(id),
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT
);
```

## 5. Core System Components

### 5.1 ID Generation Service
Following the single responsibility principle, we separate ID generation:

```python
class IDGenerator:
    def __init__(self):
        self.characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        self.base = len(self.characters)
    
    def generate_unique_id(self, length=7):
        # Generate random ID of specified length
        return ''.join(random.choice(self.characters) for _ in range(length))
    
    def encode(self, num):
        # Convert number to base62 string
        if num == 0:
            return self.characters[0]
        
        result = []
        while num > 0:
            result.append(self.characters[num % self.base])
            num //= self.base
        return ''.join(reversed(result))
```

### 5.2 URL Service
Handles core URL operations:

```python
class URLService:
    def __init__(self, db, cache, id_generator):
        self.db = db
        self.cache = cache
        self.id_generator = id_generator
    
    def shorten_url(self, original_url, custom_alias=None):
        # Validate URL
        if not self._is_valid_url(original_url):
            raise ValueError("Invalid URL")
        
        # Check if custom alias already exists
        if custom_alias and self.db.get_url_by_id(custom_alias):
            raise ValueError("Custom alias already exists")
        
        # Generate unique ID
        short_id = custom_alias or self._generate_unique_id()
        
        # Store in database
        self.db.save_url(short_id, original_url)
        
        # Cache the mapping
        self.cache.set(short_id, original_url)
        
        return short_id
    
    def get_original_url(self, short_id):
        # Check cache first
        url = self.cache.get(short_id)
        if url:
            return url
        
        # Fetch from database
        url = self.db.get_url_by_id(short_id)
        if url:
            # Cache for future requests
            self.cache.set(short_id, url)
            return url
        
        return None
    
    def _generate_unique_id(self):
        while True:
            short_id = self.id_generator.generate_unique_id()
            if not self.db.get_url_by_id(short_id):
                return short_id
    
    def _is_valid_url(self, url):
        # URL validation logic
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except:
            return False
```

### 5.3 Analytics Service
Handles analytics separately to avoid impacting redirection performance:

```python
class AnalyticsService:
    def __init__(self, db):
        self.db = db
    
    def record_click(self, short_id, ip_address, user_agent):
        # Asynchronously record click
        # This prevents analytics from slowing down redirection
        self.db.record_click_async(short_id, ip_address, user_agent)
    
    def get_analytics(self, short_id):
        return self.db.get_click_stats(short_id)
```

## 6. Scalability Solutions

### 6.1 Database Scaling
- **Read Replicas**: Multiple read replicas for URL lookups
- **Sharding**: Shard URLs by short_id hash across multiple databases
- **Connection Pooling**: Efficient database connection management

### 6.2 Caching Strategy
- **Multi-level caching**: 
  - L1: In-memory cache on each server
  - L2: Distributed cache (Redis/Memcached)
- **Cache warming**: Pre-populate cache with popular URLs
- **Cache invalidation**: TTL-based expiration

### 6.3 Load Distribution
- **CDN**: Serve static assets through CDN
- **Geographic distribution**: Servers in multiple regions
- **Load balancing**: Round-robin or least-connections routing

## 7. Reliability Patterns

### 7.1 Circuit Breaker
```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
    
    def call(self, func, *args, **kwargs):
        if self.state == "OPEN":
            if time.time() - self.last_failure_time > self.timeout:
                self.state = "HALF_OPEN"
            else:
                raise Exception("Circuit breaker is OPEN")
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise e
    
    def _on_success(self):
        self.failure_count = 0
        self.state = "CLOSED"
    
    def _on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"
```

### 7.2 Retry Logic
```python
def retry_with_backoff(func, max_retries=3, base_delay=1):
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            if attempt == max_retries - 1:
                raise e
            
            delay = base_delay * (2 ** attempt)  # Exponential backoff
            time.sleep(delay)
```

## 8. Monitoring and Observability

### 8.1 Key Metrics
- Request latency (p50, p95, p99)
- Error rates
- Cache hit ratio
- Database query performance
- System throughput (requests/second)

### 8.2 Health Checks
```python
class HealthCheckService:
    def check_database(self):
        try:
            # Simple database query
            self.db.execute("SELECT 1")
            return True
        except:
            return False
    
    def check_cache(self):
        try:
            self.cache.ping()
            return True
        except:
            return False
    
    def get_system_health(self):
        return {
            "database": self.check_database(),
            "cache": self.check_cache(),
            "disk_space": self._check_disk_space(),
            "memory_usage": self._get_memory_usage()
        }
```

## 9. Security Considerations

### 9.1 Rate Limiting
```python
class RateLimiter:
    def __init__(self, redis_client):
        self.redis = redis_client
    
    def is_allowed(self, key, limit=1000, window=3600):
        # Simple sliding window rate limiting
        current_time = int(time.time())
        window_start = current_time - window
        
        # Remove old entries
        self.redis.zremrangebyscore(key, 0, window_start)
        
        # Check current count
        current_count = self.redis.zcard(key)
        if current_count >= limit:
            return False
        
        # Add current request
        self.redis.zadd(key, {str(current_time): current_time})
        self.redis.expire(key, window)
        return True
```

### 9.2 Input Validation
- Validate all inputs (URLs, custom aliases)
- Sanitize user inputs to prevent XSS
- Implement proper authentication for admin functions

## 10. Deployment Architecture

### 10.1 Microservices Approach
- **URL Service**: Handles URL shortening and redirection
- **Analytics Service**: Manages click tracking and statistics
- **User Service**: Handles user accounts and preferences
- **Admin Service**: Provides administrative functions

### 10.2 Infrastructure
- **Containerization**: Docker containers for each service
- **Orchestration**: Kubernetes for container management
- **Service Mesh**: Istio for service-to-service communication
- **Monitoring**: Prometheus + Grafana for metrics
- **Logging**: ELK stack for log aggregation

## 11. Performance Optimization

### 11.1 Database Optimization
- Proper indexing on short_id and created_at columns
- Read replicas for scaling reads
- Connection pooling to reduce overhead

### 11.2 Caching Strategy
- Cache popular URLs with longer TTL
- Use consistent hashing for cache distribution
- Implement cache-aside pattern

### 11.3 Asynchronous Processing
- Offload analytics recording to background jobs
- Use message queues (Kafka/RabbitMQ) for decoupling
- Implement eventual consistency where appropriate

## 12. Failure Handling

### 12.1 Graceful Degradation
- If cache fails, serve directly from database
- If analytics service is down, continue serving URLs
- If database is slow, serve from stale cache

### 12.2 Data Backup and Recovery
- Regular database backups
- Cross-region replication
- Point-in-time recovery capabilities

This example demonstrates how to apply system design principles to build a scalable, reliable service. The key is to decompose the problem into manageable components, each with a single responsibility, and to use proven patterns for scalability, reliability, and maintainability.
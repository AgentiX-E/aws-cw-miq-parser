# Terraform configuration with CloudWatch Metrics Insights queries.
# This file is validated by validate-queries.ts in CI before terraform apply.

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "high-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 90

  metric_query {
    id = "m1"
    expression = <<-EOT
      SELECT AVG(CPUUtilization)
      FROM SCHEMA("AWS/EC2", InstanceId)
      WHERE InstanceType = 'm5.large'
      GROUP BY InstanceId
      ORDER BY AVG() DESC
      LIMIT 10
    EOT
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "lambda-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5

  metric_query {
    id = "q1"
    expression = <<-EOT
      SELECT SUM(Errors)
      FROM SCHEMA("AWS/Lambda", FunctionName)
      WHERE tag.env = 'prod'
      GROUP BY FunctionName
      ORDER BY SUM() DESC
      LIMIT 10
    EOT
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttle" {
  alarm_name          = "dynamodb-throttled-requests"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  threshold           = 10

  metric_query {
    id = "t1"
    expression = <<-EOT
      SELECT SUM(ThrottledRequests)
      FROM SCHEMA("AWS/DynamoDB", TableName)
      GROUP BY TableName
      ORDER BY SUM() DESC
      LIMIT 5
    EOT
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "alb-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 20

  metric_query {
    id = "a1"
    expression = <<-EOT
      SELECT SUM(HTTPCode_Target_5XX_Count)
      FROM SCHEMA("AWS/ApplicationELB", LoadBalancer, AvailabilityZone)
      WHERE LoadBalancer = 'app/my-alb/1234567890abcdef'
      GROUP BY AvailabilityZone
      ORDER BY SUM() DESC
      LIMIT 3
    EOT
    return_data = true
  }
}

pipeline {
    agent { label 'mgmt' }

    stages {
        stage('Deploy to Staging Server') {
            when {
                branch 'staging'
            }
            steps {
                script {
                    if (!(env.GIT_COMMIT ==~ /[0-9a-f]{40}/)) {
                        error("Invalid build commit: ${env.GIT_COMMIT}")
                    }
                }
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                ]) {
                    // Deploy the exact commit Jenkins built (not `git pull`), and fail fast on any
                    // remote error so a stale checkout can never be reported as a successful deploy.
                    withEnv(["DEPLOY_SHA=${env.GIT_COMMIT}"]) {
                        sh '''
                            set -eu
                            echo "Starting deployment of ${DEPLOY_SHA} to Staging server..."

                            ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "
                                set -eu
                                echo '==> Deploying Tent ${DEPLOY_SHA} to Staging...'
                                cd /home/projects/tent
                                git fetch --no-tags origin +refs/heads/staging:refs/remotes/origin/staging
                                git checkout -B staging ${DEPLOY_SHA}

                                echo '==> Building frontend image...'
                                docker compose -f docker-compose.staging.no-nginx.yml build frontend

                                echo '==> Syncing CouchDB Design Docs & Schema...'
                                docker compose -f docker-compose.staging.no-nginx.yml run --rm frontend pnpm db:sync

                                echo '==> Starting services...'
                                docker compose -f docker-compose.staging.no-nginx.yml up -d --build --force-recreate
                            "
                            echo "Deployment process finished successfully!"
                        '''
                    }
                }
            }
        }

        stage('Staging E2E (manual review)') {
            when {
                branch 'staging'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                ]) {
                    script {
                        def deployedCommit = sh(
                            returnStdout: true,
                            script: '''
                                set +x
                                ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
                                    "git -C /home/projects/tent rev-parse HEAD"
                            '''
                        ).trim()

                        if (deployedCommit != env.GIT_COMMIT) {
                            error("Staging server is at ${deployedCommit}, expected ${env.GIT_COMMIT}")
                        }

                        // The sync worker runs a full bootstrap re-projection before it starts the inbound
                        // loops (donation bookings, search audit, ...) and the _changes listeners — minutes
                        // after `up -d` when PROJECTION_VERSION was bumped. The e2e job only polls the frontend
                        // health, so a run started inside that window sees bookings that never reach CouchDB.
                        // Wait for the worker's "Sync worker running" line (logged once bootstrap is done and
                        // every loop is started) before triggering. The container was force-recreated, so its
                        // log holds this deploy only. Never fails the build (E2E does not gate the deploy):
                        // on timeout we warn and trigger anyway.
                        sh '''
                            set +x
                            if ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" 'sh -s' <<'REMOTE'
                            set -eu
                            deadline=$(( $(date +%s) + 900 ))
                            until docker logs tent-worker-staging 2>&1 | grep -q 'Sync worker running'; do
                                if [ "$(date +%s)" -ge "$deadline" ]; then
                                    echo 'sync worker not ready after 900s' >&2
                                    exit 1
                                fi
                                sleep 5
                            done
                            echo 'sync worker is running'
REMOTE
                            then
                                echo 'Staging sync worker is ready.'
                            else
                                echo 'WARNING: staging sync worker readiness not confirmed; triggering E2E anyway.'
                            fi
                        '''

                        // Fire and forget (decision 2026-10-09: E2E never gates the deploy; results are reviewed
                        // manually in the tent-e2e-staging job before promoting). Waiting held this build and its
                        // mgmt executor for the whole 15–30 min run for nothing; tent-e2e-staging reports its own
                        // result to Discord.
                        echo "Triggering tent-e2e-staging (no wait — manual review) for ${deployedCommit}"
                        build job: 'tent-e2e-staging',
                              parameters: [
                                  string(name: 'DEPLOY_COMMIT', value: deployedCommit),
                                  string(name: 'STAGING_URL', value: 'https://shelter.importstar.dev')
                              ],
                              wait: false
                        // Surfaced in the Discord deploy notification (post { always } below).
                        env.STAGING_E2E_RESULT = 'TRIGGERED'
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                script {
                    if (!(env.GIT_COMMIT ==~ /[0-9a-f]{40}/)) {
                        error("Invalid build commit: ${env.GIT_COMMIT}")
                    }
                }
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-prod-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-prod-port', variable: 'SSH_PORT')
                ]) {
                    withEnv(["DEPLOY_SHA=${env.GIT_COMMIT}"]) {
                        sh '''
                            set -eu
                            echo "Starting deployment of ${DEPLOY_SHA} to Production server..."

                            ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "
                                set -eu
                                echo '==> Deploying Tent ${DEPLOY_SHA} to Production...'
                                cd /home/projects/tent
                                git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
                                git checkout -B main ${DEPLOY_SHA}

                                echo '==> Building frontend image...'
                                docker compose -f docker-compose.production.no-nginx.yml build frontend

                                echo '==> Syncing CouchDB Design Docs & Schema...'
                                docker compose -f docker-compose.production.no-nginx.yml run --rm frontend pnpm db:sync

                                echo '==> Starting services...'
                                docker compose -f docker-compose.production.no-nginx.yml up -d --build --force-recreate
                            "
                            echo "Deployment process finished successfully!"
                        '''
                    }
                }
            }
        }

        stage('Production @prod Smoke') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    file(credentialsId: 'tent-prod-e2e-env', variable: 'E2E_ENV_FILE')
                ]) {
                    withEnv([
                        'CI=true',
                        'E2E_BASE_URL=https://shelter.psu.ac.th'
                    ]) {
                        // Read-only @prod (< 2 min). Failure fails the prod deploy job
                        // (the Discord notification in post { always } below is the alert channel).
                        sh 'chmod +x scripts/run-prod-e2e.sh && scripts/run-prod-e2e.sh'
                    }
                }
            }
            post {
                failure {
                    echo 'ALERT: Production @prod E2E smoke failed after deploy — investigate immediately.'
                    echo "Build: ${env.BUILD_URL}"
                }
            }
        }
    }

    post {
        always {
            // Discord notification (ci/README.md). Never fails the build: a missing credential,
            // a missing script or a Discord outage only logs a warning.
            script {
                try {
                    if (fileExists('ci/discord-notify.sh')) {
                        withCredentials([string(credentialsId: 'tent-discord-webhook-ci', variable: 'DISCORD_WEBHOOK_URL')]) {
                            withEnv([
                                'NOTIFY_KIND=deploy',
                                'NOTIFY_USERNAME=Tent Deploy',
                                "NOTIFY_TARGET=${env.BRANCH_NAME == 'main' ? 'prod' : 'staging'}",
                                "NOTIFY_RESULT=${currentBuild.currentResult}",
                                "NOTIFY_JOB=${env.JOB_NAME ?: ''}",
                                "NOTIFY_BRANCH=${env.BRANCH_NAME ?: ''}",
                                "NOTIFY_BUILD_NUMBER=${env.BUILD_NUMBER ?: ''}",
                                "NOTIFY_BUILD_URL=${env.BUILD_URL ?: ''}",
                                "NOTIFY_COMMIT=${env.GIT_COMMIT ?: ''}",
                                "NOTIFY_DURATION=${currentBuild.durationString.replace(' and counting', '')}",
                                "NOTIFY_E2E_RESULT=${env.STAGING_E2E_RESULT ?: ''}",
                                "NOTIFY_DETAIL=${env.STAGING_E2E_RESULT ? 'E2E runs in tent-e2e-staging and reports there' : ''}"
                            ]) {
                                def rc = sh(script: './ci/discord-notify.sh', returnStatus: true)
                                if (rc != 0) {
                                    echo "WARNING: Discord notification failed (exit ${rc}); ignoring."
                                }
                            }
                        }
                    } else {
                        echo 'WARNING: ci/discord-notify.sh not found in workspace; skipping Discord notification.'
                    }
                } catch (err) {
                    echo "WARNING: Discord notification skipped: ${err.message}"
                }
            }
            cleanWs(cleanWhenNotBuilt: false,
                    deleteDirs: true,
                    disableDeferredWipeout: true,
                    notFailBuild: true)
        }
    }
}
